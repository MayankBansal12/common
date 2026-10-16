import { afterEach, describe, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';

const modules = import.meta.glob('../convex/**/*.ts');
const site = 'https://common-test.convex.site';
const resource = `${site}/mcp`;

class TestOAuthClient implements OAuthClientProvider {
  redirectUrl = 'http://127.0.0.1:19283/callback';
  clientMetadata = {
    client_name: 'SDK integration test',
    redirect_uris: [this.redirectUrl],
    token_endpoint_auth_method: 'none' as const,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  };
  authorizationUrl?: URL;
  registration?: OAuthClientInformationMixed;
  credentials?: OAuthTokens;
  verifier = '';
  state() { return 'independent-sdk-test-state'; }
  clientInformation() { return this.registration; }
  saveClientInformation(value: OAuthClientInformationMixed) { this.registration = value; }
  tokens() { return this.credentials; }
  saveTokens(value: OAuthTokens) { this.credentials = value; }
  redirectToAuthorization(url: URL) { this.authorizationUrl = url; }
  saveCodeVerifier(value: string) { this.verifier = value; }
  codeVerifier() { return this.verifier; }
}

// This adapter deliberately passes every HTTP request through the real Convex router.
// The SDK performs discovery, registration, PKCE, token exchange and MCP negotiation.
function adapter(t: ReturnType<typeof convexTest>) {
  const requests: Array<{ path: string; method: string; status: number }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.origin !== site) throw new Error('Unexpected origin in SDK request');
    const body = ['GET','HEAD'].includes(req.method) ? undefined : await req.text();
    const res = await t.fetch(url.pathname + url.search, { method: req.method, headers: req.headers, body });
    requests.push({ path: url.pathname, method: req.method, status: res.status });
    return res;
  };
  return { fetcher, requests };
}

afterEach(() => vi.unstubAllEnvs());

async function setup(scopes: string[] = ['messages:read', 'messages:send']) {
  vi.stubEnv('CONVEX_SITE_URL', site);
  vi.stubEnv('SITE_URL', 'https://common.example');
  const t = convexTest(schema, modules);
  const userId = await t.run(ctx => ctx.db.insert('users', { name: 'SDK Owner', email: 'sdk-owner@example.com', emailVerificationTime: Date.now() }));
  const owner = t.withIdentity({ subject: userId });
  const spaceId = await owner.mutation(api.spaces.create, { name: 'Shared with agent', symbol: '✳', color: 0 });
  const privateId = await owner.mutation(api.spaces.create, { name: 'Human only', symbol: '☀', color: 1 });
  const secret = 'cmn_pat_' + 'a'.repeat(43);
  const hashBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)));
  const hash = btoa(String.fromCharCode(...hashBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const connectionId = await t.run(async ctx => {
    const id = await ctx.db.insert('agentConnections', { userId, name: 'Review agent', kind: 'token', scopes, spaceMode: 'selected', spaceIds: [spaceId] });
    await ctx.db.insert('agentTokens', { connectionId: id, hash, kind: 'personal' });
    return id;
  });
  const { fetcher, requests } = adapter(t);
  const client = new Client({ name: 'common-independent-review', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(resource), { fetch: fetcher, requestInit: { headers: { Authorization: `Bearer ${secret}` } } });
  await client.connect(transport);
  return { t, owner, userId, spaceId, privateId, connectionId, client, transport, requests };
}

describe('Common through the official MCP client', () => {
  test('negotiates HTTP, discovers scoped tools, attributes and deduplicates sends, and preserves unread state', async () => {
    const { t, owner, userId, spaceId, privateId, connectionId, client, transport, requests } = await setup();
    try {
      expect(client.getServerVersion()?.name.toLowerCase()).toContain('common');
      expect(transport.protocolVersion).toBe('2025-11-25');
      const names = (await client.listTools()).tools.map(tool => tool.name);
      expect(names).toEqual(expect.arrayContaining(['whoami', 'list_spaces', 'read_messages', 'catch_up', 'search_messages', 'send_message']));
      expect(names).not.toContain('create_space');
      expect(names).not.toContain('update_profile');
      const identity = await client.callTool({ name: 'whoami', arguments: {} });
      expect(identity.structuredContent).toMatchObject({ user: { id: userId, name: 'SDK Owner' }, agent: { id: connectionId, name: 'Review agent' } });
      const spaces = await client.callTool({ name: 'list_spaces', arguments: {} });
      expect(spaces.structuredContent).toMatchObject({ spaces: [{ id: spaceId, name: 'Shared with agent' }] });
      const sendArgs = { space_id: spaceId, text: 'Hello from a real MCP client', request_id: 'sdk-message-retry-001' };
      const sent = await client.callTool({ name: 'send_message', arguments: sendArgs });
      expect(sent.isError).not.toBe(true);
      const retry = await client.callTool({ name: 'send_message', arguments: sendArgs });
      expect(retry.structuredContent).toMatchObject({ deduplicated: true });
      const read = await client.callTool({ name: 'read_messages', arguments: { space_id: spaceId } });
      expect(read.structuredContent).toMatchObject({ messages: [{ text: sendArgs.text, author: { kind: 'agent', agent_name: 'Review agent', on_behalf_of: 'SDK Owner', is_this_connection: true } }] });
      expect((await owner.query(api.spaces.list)).find(s => s.id === spaceId)?.unread).toBe(1);
      const stored = await t.run(ctx => ctx.db.query('messages').collect());
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ senderId: userId, agentId: connectionId, actorKind: 'agent' });
      const forbidden = await client.callTool({ name: 'read_messages', arguments: { space_id: privateId } });
      expect(forbidden.isError).toBe(true);
      expect(JSON.stringify(forbidden)).not.toContain('Human only');
      expect(requests.some(r => r.path === '/mcp' && r.method === 'POST' && r.status === 202)).toBe(true);
    } finally { await client.close(); }
  });

  test('enforces scope reductions and revocation after the client has connected', async () => {
    const { t, spaceId, connectionId, client, requests } = await setup();
    try {
      await client.listTools(); // Cache the original send tool, as a connected client would.
      await t.run(ctx => ctx.db.patch(connectionId, { scopes: ['messages:read'] }));
      await expect(client.callTool({ name: 'send_message', arguments: { space_id: spaceId, text: 'Must not send', request_id: 'blocked-sdk-request' } })).rejects.toThrow();
      expect(requests.at(-1)?.status).toBe(403);
      expect((await client.listTools()).tools.map(t => t.name)).not.toContain('send_message');
      expect(await t.run(ctx => ctx.db.query('messages').collect())).toHaveLength(0);
      await t.run(ctx => ctx.db.delete(connectionId));
      await expect(client.listTools()).rejects.toThrow();
      expect(requests.at(-1)?.status).toBe(401);
    } finally { await client.close(); }
  });
});

describe('OAuth with the official MCP client', () => {
  test('discovers, registers, approves, exchanges PKCE, refreshes twice, and detects an older refresh-token replay', async () => {
    vi.stubEnv('CONVEX_SITE_URL', site);
    vi.stubEnv('SITE_URL', 'https://common.example');
    const t = convexTest(schema, modules);
    const userId = await t.run(ctx => ctx.db.insert('users', { name: 'OAuth Owner', email: 'oauth-owner@example.com', emailVerificationTime: Date.now() }));
    const owner = t.withIdentity({ subject: userId });
    const spaceId = await owner.mutation(api.spaces.create, { name: 'OAuth space', symbol: '✳', color: 0 });
    const { fetcher, requests } = adapter(t);
    const auth = new TestOAuthClient();
    const transport = new StreamableHTTPClientTransport(new URL(resource), { fetch: fetcher, authProvider: auth });
    const initial = new Client({ name: 'oauth-client-review', version: '1.0.0' });
    let connected: Client | undefined;
    try {
      await expect(initial.connect(transport)).rejects.toThrow();
      expect(auth.authorizationUrl).toBeInstanceOf(URL);
      expect(auth.registration?.client_id).toBeTruthy();
      expect(auth.authorizationUrl!.searchParams.get('code_challenge_method')).toBe('S256');
      expect(auth.authorizationUrl!.searchParams.get('resource')).toBe(resource);
      const browserResponse = await t.fetch(auth.authorizationUrl!.pathname + auth.authorizationUrl!.search);
      expect(browserResponse.status).toBe(302);
      const consentUrl = new URL(browserResponse.headers.get('location')!);
      expect(consentUrl.origin).toBe('https://common.example');
      const requestId = consentUrl.searchParams.get('authorize')!;
      const consent = await owner.query(api.agents.consentRequest, { requestId });
      expect(consent).toMatchObject({ status: 'ready', redirectHost: '127.0.0.1:19283' });
      const approval = await owner.action(api.agents.approve, { requestId, name: 'Approved agent', scopes: ['messages:read', 'messages:send'], spaceMode: 'selected', spaceIds: [spaceId] });
      const callback = new URL(approval.redirectUrl);
      expect(callback.origin + callback.pathname).toBe(auth.redirectUrl);
      expect(callback.searchParams.get('state')).toBe(auth.state());
      expect(callback.searchParams.get('iss')).toBe(site);
      await transport.finishAuth(callback.searchParams.get('code')!);
      const originalRefresh = auth.credentials?.refresh_token;
      expect(originalRefresh).toBeTruthy();
      const newClient = async () => {
        const c = new Client({ name: 'oauth-client-review', version: '1.0.0' });
        await c.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: fetcher, authProvider: auth }));
        return c;
      };
      connected = await newClient();
      expect((await connected.callTool({ name: 'whoami', arguments: {} })).structuredContent).toMatchObject({ user: { id: userId }, agent: { name: 'Approved agent' } });
      for (let rotation = 0; rotation < 2; rotation++) {
        await connected.close();
        await t.run(async ctx => {
          for (const token of await ctx.db.query('agentTokens').collect()) if (token.kind === 'access') await ctx.db.patch(token._id, { expiresAt: Date.now() - 1 });
        });
        connected = await newClient();
        expect((await connected.listTools()).tools.some(tool => tool.name === 'read_messages')).toBe(true);
      }
      expect(auth.credentials?.refresh_token === originalRefresh).toBe(false);
      const replay = await t.fetch('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: originalRefresh!, client_id: auth.registration!.client_id, resource }).toString() });
      expect(replay.status).toBe(400);
      expect((await replay.json()).error).toBe('invalid_grant');
      // Verify the effect of replay detection, not only its error response.
      const latest = await t.fetch('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${auth.credentials!.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list' }) });
      expect(latest.status).toBe(401);
      expect(requests.some(r => r.path.includes('oauth-protected-resource') && r.status === 200)).toBe(true);
      expect(requests.some(r => r.path === '/oauth/register' && r.status === 201)).toBe(true);
      expect(requests.filter(r => r.path === '/oauth/token' && r.status === 200)).toHaveLength(3);
    } finally {
      await initial.close();
      await connected?.close();
      await transport.close();
    }
  });
});

test('an SDK client can discover selected spaces beyond the first membership page and page through all spaces', async () => {
  const { t, userId, connectionId, client } = await setup();
  try {
    const extra = await t.run(async ctx => {
      const ids = [];
      for (let i = 0; i < 205; i++) {
        const id = await ctx.db.insert('spaces', { name: `Space ${i}`, symbol: '✳', color: 0, ownerId: userId, memberCount: 1, messageCount: 0, updatedAt: Date.now() });
        await ctx.db.insert('memberships', { spaceId: id, userId, role: 'owner', lastReadSequence: 0 });
        ids.push(id);
      }
      return ids;
    });
    await t.run(ctx => ctx.db.patch(connectionId, { spaceIds: [extra.at(-1)!] }));
    const selected = await client.callTool({ name: 'list_spaces', arguments: {} });
    expect(selected.structuredContent).toMatchObject({ spaces: [{ id: extra.at(-1), name: 'Space 204' }], next_cursor: null });
    await t.run(ctx => ctx.db.patch(connectionId, { spaceMode: 'all', spaceIds: [] }));
    let cursor: string | null = null;
    const seen: string[] = [];
    for (let page = 0; page < 4; page++) {
      const result = await client.callTool({ name: 'list_spaces', arguments: cursor ? { cursor } : {} });
      expect(result.isError).not.toBe(true);
      const data = result.structuredContent as { spaces: Array<{ id: string }>; next_cursor: string | null };
      seen.push(...data.spaces.map(s => s.id));
      cursor = data.next_cursor;
      if (!cursor) break;
    }
    expect(cursor).toBe(null);
    expect(seen).toHaveLength(207);
    expect(new Set(seen).size).toBe(207);
  } finally { await client.close(); }
});
