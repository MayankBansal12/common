import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { createHash, randomBytes } from 'node:crypto';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { TOKEN_GRANT_LIMIT, TOKEN_MISS_LIMIT } from '../convex/oauth';

const modules = import.meta.glob('../convex/**/*.ts');
const SITE = 'https://common-test.convex.site';
const APP = 'https://common.example';
const RESOURCE = `${SITE}/mcp`;
const ALL = ['messages:read', 'messages:send', 'spaces:manage', 'profile:write'];
const paginationOpts = { numItems: 50, cursor: null };

// Revoking schedules a token sweep on a timer. Faking timers lets each test drain its own scheduled functions:
// left running, one fires during the next test and writes to a runtime that no longer exists.
let current: ReturnType<typeof convexTest> | null = null;
beforeEach(() => {
  vi.stubEnv('CONVEX_SITE_URL', SITE);
  vi.stubEnv('SITE_URL', APP);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(async () => {
  try {
    if (!current) return;
    await current.finishAllScheduledFunctions(vi.runAllTimers);
    const jobs = await current.run(ctx => ctx.db.system.query('_scheduled_functions').collect());
    expect(jobs.filter(j => j.state.kind !== 'success' && j.state.kind !== 'canceled').map(j => [j.name, j.state.kind])).toEqual([]);
  } finally {
    current = null;
    vi.useRealTimers();
    vi.unstubAllEnvs();
  }
});

async function setup() {
  const t = (current = convexTest(schema, modules));
  const ids = await t.run(async ctx => ({
    owner: await ctx.db.insert('users', { name: 'Owner', email: 'owner@example.com', emailVerificationTime: Date.now() }),
    guest: await ctx.db.insert('users', { name: 'Guest', email: 'guest@example.com', emailVerificationTime: Date.now() }),
    stranger: await ctx.db.insert('users', { name: 'Stranger', email: 'stranger@example.com', emailVerificationTime: Date.now() }),
  }));
  const owner = t.withIdentity({ subject: ids.owner });
  const guest = t.withIdentity({ subject: ids.guest });
  const stranger = t.withIdentity({ subject: ids.stranger });
  const spaceId = await owner.mutation(api.spaces.create, { name: 'Studio', symbol: '✳', color: 0 });
  const otherSpace = await owner.mutation(api.spaces.create, { name: 'Private', symbol: '🌙', color: 1 });
  const invitationId = await owner.mutation(api.members.invite, { spaceId, email: 'guest@example.com' });
  await guest.mutation(api.members.accept, { invitationId });

  type Who = typeof owner;
  const connect = async (who: Who, opts: { scopes?: string[]; spaceMode?: 'all' | 'selected'; spaceIds?: Id<'spaces'>[]; name?: string; expiresInDays?: 30 | 90 } = {}) =>
    who.action(api.agents.createToken, { name: opts.name ?? 'Helper', scopes: opts.scopes ?? ALL, spaceMode: opts.spaceMode ?? 'all', spaceIds: opts.spaceIds ?? [], expiresInDays: opts.expiresInDays });
  let nextId = 1;
  const rpc = async (token: string | null, method: string, params?: unknown, headers: Record<string, string> = {}) => {
    const res = await t.fetch('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };
  /** Calls a tool; returns the parsed result, or `{ error, status }` for protocol-level refusals. */
  const tool = async (token: string, name: string, args: Record<string, unknown> = {}) => {
    const res = await rpc(token, 'tools/call', { name, arguments: args });
    if (res.status !== 200) return { status: res.status, error: res.body?.error, challenge: res.headers.get('WWW-Authenticate') };
    if (res.body.error) return { status: 200, rpcError: res.body.error };
    const result = res.body.result;
    return result.isError ? { status: 200, isError: true, text: result.content[0].text as string } : { status: 200, data: result.structuredContent };
  };
  return { t, ids, owner, guest, stranger, spaceId, otherSpace, connect, rpc, tool };
}

const requestId = () => randomBytes(9).toString('base64url');

describe('MCP over HTTP', () => {
  test('requires a bearer token and points clients at OAuth discovery', async () => {
    const { rpc } = await setup();
    const res = await rpc(null, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(res.status).toBe(401);
    const challenge = res.headers.get('WWW-Authenticate')!;
    expect(challenge).toContain(`resource_metadata="${SITE}/.well-known/oauth-protected-resource/mcp"`);
    expect(challenge).toContain(`scope="${ALL.join(' ')}"`);
    const bad = await rpc('cmn_at_' + 'x'.repeat(43), 'ping');
    expect(bad.status).toBe(401);
    expect(bad.headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
  });

  test('initializes, negotiates versions, pings, and answers notifications with 202', async () => {
    const { owner, connect, rpc, t } = await setup();
    const { token } = await connect(owner);
    const init = await rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(init.status).toBe(200);
    expect(init.headers.get('Content-Type')).toContain('application/json');
    expect(init.body.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'common' } });
    expect((await rpc(token, 'initialize', { protocolVersion: '1999-01-01' })).body.result.protocolVersion).toBe('2025-11-25');
    expect((await rpc(token, 'ping')).body.result).toEqual({});
    const note = await t.fetch('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    expect(note.status).toBe(202);
    expect((await rpc(token, 'resources/list')).body.error.code).toBe(-32601);
    expect((await rpc(token, 'ping', {}, { 'MCP-Protocol-Version': '2020-01-01' })).status).toBe(400);
  });

  test('rejects malformed requests, batches, foreign origins and other methods', async () => {
    const { owner, connect, rpc, t } = await setup();
    const { token } = await connect(owner);
    const post = (body: string, headers: Record<string, string> = {}) => t.fetch('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body });
    expect((await post('{nope')).status).toBe(400);
    expect((await post(JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }]))).status).toBe(400);
    expect((await rpc(token, 'ping', {}, { Origin: 'https://evil.example' })).status).toBe(403);
    const allowed = await rpc(token, 'ping', {}, { Origin: APP });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect((await t.fetch('/mcp', { method: 'GET' })).status).toBe(401);
    expect((await t.fetch('/mcp', { method: 'GET', headers: { Authorization: `Bearer ${token}` } })).status).toBe(405);
    const unknown = await rpc(token, 'tools/call', { name: 'drop_tables', arguments: {} });
    expect(unknown.body.error.code).toBe(-32602);
  });

  test('validates tool arguments as tool errors the agent can correct', async () => {
    const { owner, connect, tool, spaceId } = await setup();
    const { token } = await connect(owner);
    expect(await tool(token, 'read_messages', {})).toMatchObject({ isError: true, text: expect.stringContaining('space_id') });
    expect(await tool(token, 'read_messages', { space_id: spaceId, limit: 500 })).toMatchObject({ isError: true, text: expect.stringContaining('limit') });
    expect(await tool(token, 'read_messages', { space_id: spaceId, extra: 1 })).toMatchObject({ isError: true, text: expect.stringContaining('extra') });
    expect(await tool(token, 'read_messages', { space_id: 'not-an-id' })).toMatchObject({ isError: true });
    expect(await tool(token, 'send_message', { space_id: spaceId, text: 'Hi' })).toMatchObject({ isError: true, text: expect.stringContaining('request_id') });
    expect(await tool(token, 'send_message', { space_id: spaceId, text: 'a'.repeat(2001), request_id: requestId() })).toMatchObject({ isError: true, text: expect.stringContaining('2,000') });
    expect(await tool(token, 'create_space', { name: 'X', color: 9 })).toMatchObject({ isError: true, text: expect.stringContaining('color') });
    expect(await tool(token, 'invite_member', { space_id: spaceId, email: 'not-an-email' })).toMatchObject({ isError: true, text: expect.stringContaining('email') });
  });
});

describe('scopes', () => {
  test('tools/list shows only what each grant allows', async () => {
    const { owner, connect, rpc } = await setup();
    const names = async (scopes: string[]) => (await rpc((await connect(owner, { scopes })).token, 'tools/list')).body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(await names([])).toEqual(['whoami']);
    expect(await names(['messages:read'])).toEqual(['list_members', 'list_spaces', 'read_messages', 'whoami']);
    expect(await names(['messages:send'])).toEqual(['list_spaces', 'send_message', 'whoami']);
    expect(await names(['profile:write'])).toEqual(['update_profile', 'whoami']);
    expect(await names(['spaces:manage'])).toEqual(['create_space', 'invite_member', 'list_members', 'list_spaces', 'remove_member', 'revoke_invitation', 'update_space', 'whoami']);
  });

  test('every scope is enforced server-side with 403 insufficient_scope', async () => {
    const { owner, connect, tool, spaceId } = await setup();
    const { token: none } = await connect(owner, { scopes: [] });
    const cases: [string, Record<string, unknown>, string][] = [
      ['read_messages', { space_id: spaceId }, 'messages:read'],
      ['send_message', { space_id: spaceId, text: 'Hi', request_id: requestId() }, 'messages:send'],
      ['create_space', { name: 'Agent space' }, 'spaces:manage'],
      ['update_space', { space_id: spaceId, name: 'Renamed' }, 'spaces:manage'],
      ['invite_member', { space_id: spaceId, email: 'x@example.com' }, 'spaces:manage'],
      ['update_profile', { name: 'Renamed' }, 'profile:write'],
    ];
    for (const [name, args, scope] of cases) {
      const denied = await tool(none, name, args);
      expect(denied.status).toBe(403);
      expect(denied.challenge).toContain('error="insufficient_scope"');
      expect(denied.challenge).toContain(`scope="${scope}"`);
      const { token } = await connect(owner, { scopes: [scope] });
      expect((await tool(token, name, args)).data).toBeTruthy();
    }
    expect((await tool(none, 'whoami')).data).toMatchObject({ user: { name: 'Renamed' }, agent: { name: 'Helper' }, scopes: [] });
  });

  test('previews and member emails need the matching scope', async () => {
    const { owner, connect, tool, spaceId } = await setup();
    await owner.mutation(api.messages.send, { spaceId, body: 'Secret plans', clientId: 'human-message-0001' });
    const { token: sender } = await connect(owner, { scopes: ['messages:send'] });
    const spaces = (await tool(sender, 'list_spaces')).data.spaces;
    expect(spaces[0]).not.toHaveProperty('last_message');
    expect(spaces[0]).not.toHaveProperty('unread');
    const { token: reader } = await connect(owner, { scopes: ['messages:read'] });
    expect((await tool(reader, 'list_members', { space_id: spaceId })).data.members[0]).not.toHaveProperty('email');
    const { token: manager } = await connect(owner, { scopes: ['spaces:manage'] });
    expect((await tool(manager, 'list_members', { space_id: spaceId })).data.members.map((m: { email: string }) => m.email)).toContain('guest@example.com');
  });
});

describe('spaces and people', () => {
  test('chosen-space grants see only those spaces and keep spaces they create', async () => {
    const { owner, connect, tool, spaceId, otherSpace } = await setup();
    const { token } = await connect(owner, { spaceMode: 'selected', spaceIds: [spaceId] });
    expect((await tool(token, 'list_spaces')).data.spaces.map((s: { id: string }) => s.id)).toEqual([spaceId]);
    expect(await tool(token, 'read_messages', { space_id: otherSpace })).toMatchObject({ isError: true, text: expect.stringContaining('isn’t shared') });
    expect(await tool(token, 'send_message', { space_id: otherSpace, text: 'Hi', request_id: requestId() })).toMatchObject({ isError: true });
    const created = (await tool(token, 'create_space', { name: 'Made by agent' })).data.space_id;
    expect((await tool(token, 'list_spaces')).data.spaces.map((s: { id: string }) => s.id).sort()).toEqual([spaceId, created].sort());
    // A space the person creates later is not added.
    const later = await owner.mutation(api.spaces.create, { name: 'Later', symbol: '✳', color: 2 });
    expect(await tool(token, 'read_messages', { space_id: later })).toMatchObject({ isError: true });
    const { token: all } = await connect(owner, { spaceMode: 'all' });
    expect((await tool(all, 'read_messages', { space_id: later })).data).toBeTruthy();
  });

  test('agents never reach spaces their person is not in', async () => {
    const { guest, connect, tool, otherSpace, spaceId } = await setup();
    const { token } = await connect(guest);
    expect((await tool(token, 'list_spaces')).data.spaces.map((s: { id: string }) => s.id)).toEqual([spaceId]);
    for (const [name, args] of [['read_messages', { space_id: otherSpace }], ['send_message', { space_id: otherSpace, text: 'x', request_id: requestId() }], ['update_space', { space_id: otherSpace, name: 'Mine' }], ['list_members', { space_id: otherSpace }], ['invite_member', { space_id: otherSpace, email: 'x@example.com' }]] as const)
      expect(await tool(token, name, args)).toMatchObject({ isError: true });
  });

  test('removal from a space cuts agent access at once, and re-inviting does not restore a chosen-space grant', async () => {
    const { owner, guest, ids, connect, tool, spaceId } = await setup();
    const { token: chosen } = await connect(guest, { spaceMode: 'selected', spaceIds: [spaceId] });
    const { token: all } = await connect(guest, { spaceMode: 'all' });
    expect((await tool(chosen, 'read_messages', { space_id: spaceId })).data).toBeTruthy();
    await owner.mutation(api.members.remove, { spaceId, userId: ids.guest });
    for (const token of [chosen, all]) {
      expect(await tool(token, 'read_messages', { space_id: spaceId })).toMatchObject({ isError: true });
      expect(await tool(token, 'send_message', { space_id: spaceId, text: 'Still here?', request_id: requestId() })).toMatchObject({ isError: true });
    }
    const invitationId = await owner.mutation(api.members.invite, { spaceId, email: 'guest@example.com' });
    await guest.mutation(api.members.accept, { invitationId });
    expect(await tool(chosen, 'read_messages', { space_id: spaceId })).toMatchObject({ isError: true });
    expect((await tool(all, 'read_messages', { space_id: spaceId })).data).toBeTruthy();
  });

  test('owner-only rules apply to agents exactly as to their person', async () => {
    const { owner, guest, ids, connect, tool, spaceId } = await setup();
    const { token: guestAgent } = await connect(guest);
    expect(await tool(guestAgent, 'remove_member', { space_id: spaceId, user_id: ids.owner })).toMatchObject({ isError: true, text: expect.stringContaining('owner') });
    const { token: ownerAgent } = await connect(owner);
    expect(await tool(ownerAgent, 'remove_member', { space_id: spaceId, user_id: ids.owner })).toMatchObject({ isError: true, text: expect.stringContaining('owner cannot') });
    // Any member may rename (existing rule); the activity shows the agent.
    expect((await tool(guestAgent, 'update_space', { space_id: spaceId, name: 'Renamed by agent' })).data).toBeTruthy();
    expect((await owner.query(api.members.activity, { spaceId }))[0]).toMatchObject({ kind: 'space_updated', actorName: 'Guest', agentName: 'Helper' });
    const invited = (await tool(guestAgent, 'invite_member', { space_id: spaceId, email: 'new@example.com' })).data.invitation_id;
    const invitations = (await tool(guestAgent, 'list_members', { space_id: spaceId })).data.pending_invitations;
    expect(invitations).toEqual([{ id: invited, email: 'ne•••@example.com', can_revoke: true }]);
    expect((await tool(ownerAgent, 'remove_member', { space_id: spaceId, user_id: ids.guest })).data).toEqual({ removed: true });
    expect(await tool(guestAgent, 'list_members', { space_id: spaceId })).toMatchObject({ isError: true });
  });

  test('profile edits change only the person’s own name and avatar', async () => {
    const { owner, connect, tool } = await setup();
    const { token } = await connect(owner, { scopes: ['profile:write'] });
    expect(await tool(token, 'update_profile', {})).toMatchObject({ isError: true });
    await tool(token, 'update_profile', { name: 'Owner (via agent)', avatar_seed: 'abc123' });
    expect(await owner.query(api.users.me)).toMatchObject({ name: 'Owner (via agent)', avatarSeed: 'abc123' });
    expect(await tool(token, 'update_profile', { name: ' ' })).toMatchObject({ isError: true });
  });
});

describe('messages from agents', () => {
  test('are attributed to the agent and its person, and cannot pass as human', async () => {
    const { owner, guest, connect, tool, spaceId, ids } = await setup();
    const { token } = await connect(owner, { name: 'Guest' });
    await tool(token, 'send_message', { space_id: spaceId, text: 'Build finished', request_id: requestId() });
    const [message] = (await guest.query(api.messages.list, { spaceId, paginationOpts })).page;
    expect(message).toMatchObject({ body: 'Build finished', sender: { id: ids.owner, name: 'Owner' }, agent: { name: 'Guest' } });
    const read = (await tool(token, 'read_messages', { space_id: spaceId })).data.messages[0];
    expect(read.author).toMatchObject({ kind: 'agent', agent_name: 'Guest', on_behalf_of: 'Owner', is_this_connection: true });
    // No tool accepts a sender, kind or name, and unknown arguments are refused.
    expect(await tool(token, 'send_message', { space_id: spaceId, text: 'I am human', request_id: requestId(), sender: ids.guest })).toMatchObject({ isError: true });
    // People's client IDs can never take an agent's namespace.
    await expect(owner.mutation(api.messages.send, { spaceId, body: 'x', clientId: `agent:${message.agent!.id}:abcdefgh` })).rejects.toThrow('identifier');
  });

  test('sends are idempotent per connection and request ID', async () => {
    const { owner, connect, tool, spaceId } = await setup();
    const { token: a } = await connect(owner);
    const { token: b } = await connect(owner);
    const first = (await tool(a, 'send_message', { space_id: spaceId, text: 'Once', request_id: 'retry-key-0001' })).data;
    expect(first.deduplicated).toBe(false);
    expect((await tool(a, 'send_message', { space_id: spaceId, text: 'Once', request_id: 'retry-key-0001' })).data).toEqual({ ...first, deduplicated: true });
    expect(await tool(a, 'send_message', { space_id: spaceId, text: 'Changed', request_id: 'retry-key-0001' })).toMatchObject({ isError: true, text: expect.stringContaining('already used') });
    expect((await tool(b, 'send_message', { space_id: spaceId, text: 'Once', request_id: 'retry-key-0001' })).data.message_id).not.toBe(first.message_id);
    expect((await owner.query(api.messages.list, { spaceId, paginationOpts })).page).toHaveLength(2);
  });

  test('reading never marks messages read, and agent sends leave the person’s unread state alone', async () => {
    const { owner, guest, connect, tool, spaceId } = await setup();
    await owner.mutation(api.messages.send, { spaceId, body: 'One', clientId: 'unread-message-001' });
    await owner.mutation(api.messages.send, { spaceId, body: 'Two', clientId: 'unread-message-002' });
    const { token } = await connect(guest);
    expect((await tool(token, 'read_messages', { space_id: spaceId })).data.messages.map((m: { text: string }) => m.text)).toEqual(['One', 'Two']);
    expect((await guest.query(api.spaces.list))[0].unread).toBe(2);
    await tool(token, 'send_message', { space_id: spaceId, text: 'Three', request_id: requestId() });
    expect((await guest.query(api.spaces.list))[0].unread).toBe(3);
    expect((await tool(token, 'list_spaces')).data.spaces[0].unread).toBe(3);
  });

  test('pages through history with bounded reads', async () => {
    const { owner, connect, tool, spaceId } = await setup();
    for (let i = 1; i <= 7; i++) await owner.mutation(api.messages.send, { spaceId, body: `M${i}`, clientId: `paged-message-00${i}` });
    const { token } = await connect(owner);
    const latest = (await tool(token, 'read_messages', { space_id: spaceId, limit: 3 })).data;
    expect(latest.messages.map((m: { sequence: number }) => m.sequence)).toEqual([5, 6, 7]);
    expect(latest).toMatchObject({ has_more: true, next_before_sequence: 5 });
    const older = (await tool(token, 'read_messages', { space_id: spaceId, limit: 3, before_sequence: 5 })).data;
    expect(older.messages.map((m: { sequence: number }) => m.sequence)).toEqual([2, 3, 4]);
    const newer = (await tool(token, 'read_messages', { space_id: spaceId, after_sequence: 5 })).data;
    expect(newer.messages.map((m: { sequence: number }) => m.sequence)).toEqual([6, 7]);
    expect(newer).toMatchObject({ has_more: false, next_after_sequence: 7 });
  });
});

describe('managing connections', () => {
  test('revoking, narrowing and expiry take effect on the next call', async () => {
    const { t, owner, guest, connect, tool, spaceId, otherSpace } = await setup();
    const { token, connectionId } = await connect(owner);
    const [listed] = await owner.query(api.agents.list);
    expect(listed).toMatchObject({ id: connectionId, name: 'Helper', kind: 'token', scopes: ALL, spaceMode: 'all' });
    expect(JSON.stringify(listed)).not.toContain(token);
    // A new token isn't connected until it makes an authenticated request.
    expect(listed.lastUsedAt).toBeUndefined();
    expect((await tool('cmn_pat_not-a-real-token', 'whoami')).status).toBe(401);
    expect((await owner.query(api.agents.list))[0].lastUsedAt).toBeUndefined();
    expect(await guest.query(api.agents.list)).toEqual([]);
    await expect(guest.mutation(api.agents.update, { connectionId, name: 'Mine', scopes: ALL, spaceMode: 'all', spaceIds: [] })).rejects.toThrow('no longer exists');
    await guest.mutation(api.agents.revoke, { connectionId });
    expect((await tool(token, 'whoami')).data).toBeTruthy();
    expect((await owner.query(api.agents.list))[0].lastUsedAt).toEqual(expect.any(Number));

    await owner.mutation(api.agents.update, { connectionId, name: 'Narrow', scopes: ['messages:read'], spaceMode: 'selected', spaceIds: [spaceId] });
    expect((await tool(token, 'send_message', { space_id: spaceId, text: 'x', request_id: requestId() })).status).toBe(403);
    expect(await tool(token, 'read_messages', { space_id: otherSpace })).toMatchObject({ isError: true });
    expect((await tool(token, 'whoami')).data.agent.name).toBe('Narrow');
    await expect(owner.mutation(api.agents.update, { connectionId, name: 'x', scopes: ['admin'], spaceMode: 'all', spaceIds: [] })).rejects.toThrow('Unknown permission');
    const strangersSpace = await t.withIdentity({ subject: (await t.run(ctx => ctx.db.insert('users', { name: 'S', email: 's@example.com', emailVerificationTime: Date.now() }))) }).mutation(api.spaces.create, { name: 'Theirs', symbol: '✳', color: 0 });
    await expect(owner.mutation(api.agents.update, { connectionId, name: 'x', scopes: [], spaceMode: 'selected', spaceIds: [strangersSpace] })).rejects.toThrow('belong');

    await owner.mutation(api.agents.revoke, { connectionId });
    expect((await tool(token, 'whoami')).status).toBe(401);
    expect(await owner.query(api.agents.list)).toEqual([]);

    const expiring = await connect(owner, { expiresInDays: 30 });
    expect((await tool(expiring.token, 'whoami')).data).toBeTruthy();
    await t.run(ctx => ctx.db.patch(expiring.connectionId, { expiresAt: Date.now() - 1 }));
    expect((await tool(expiring.token, 'whoami')).status).toBe(401);
  });

  test('stores only hashes and caps active connections', async () => {
    const { t, owner, connect } = await setup();
    const { token } = await connect(owner);
    const rows = await t.run(ctx => ctx.db.query('agentTokens').collect());
    expect(JSON.stringify(rows)).not.toContain(token);
    for (let i = 1; i < 25; i++) await connect(owner);
    await expect(connect(owner)).rejects.toThrow('up to 25');
  });
});

// ---- OAuth -----------------------------------------------------------------------------------

const REDIRECT = 'http://127.0.0.1:33418/callback';
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
async function oauthSetup() {
  const base = await setup();
  const { t } = base;
  const register = (body: unknown) => t.fetch('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const reg = await (await register({ client_name: 'Test Agent', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' })).json();
  const authorize = async (params: Record<string, string>) => t.fetch(`/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge_method: 'S256', resource: RESOURCE, state: 'st4te', ...params })}`, { method: 'GET' });
  const tokenRequest = (params: Record<string, string>) => t.fetch('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: reg.client_id, ...params }).toString() });
  /** Runs the browser part: authorize → consent → approve. Returns the code and PKCE verifier. */
  const consent = async (grant: { scopes?: string[]; spaceMode?: 'all' | 'selected'; spaceIds?: Id<'spaces'>[] } = {}, scope?: string) => {
    const { verifier, challenge } = pkce();
    const res = await authorize({ code_challenge: challenge, ...(scope !== undefined ? { scope } : {}) });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(location.origin).toBe(APP);
    const requestId = location.searchParams.get('authorize')!;
    const { redirectUrl } = await base.owner.action(api.agents.approve, { requestId, name: 'Test Agent', scopes: grant.scopes ?? ['messages:read', 'messages:send'], spaceMode: grant.spaceMode ?? 'all', spaceIds: grant.spaceIds ?? [] });
    const back = new URL(redirectUrl);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('state')).toBe('st4te');
    expect(back.searchParams.get('iss')).toBe(SITE);
    return { code: back.searchParams.get('code')!, verifier, requestId };
  };
  const exchange = (code: string, verifier: string, extra: Record<string, string> = {}) => tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, resource: RESOURCE, ...extra });
  return { ...base, reg, register, authorize, tokenRequest, consent, exchange };
}

describe('OAuth', () => {
  test('publishes protected resource and authorization server metadata', async () => {
    const { t } = await setup();
    const resource = await (await t.fetch('/.well-known/oauth-protected-resource/mcp')).json();
    expect(resource).toMatchObject({ resource: RESOURCE, authorization_servers: [SITE], scopes_supported: ALL });
    const server = await (await t.fetch('/.well-known/oauth-authorization-server')).json();
    expect(server).toMatchObject({ issuer: SITE, authorization_endpoint: `${SITE}/oauth/authorize`, token_endpoint: `${SITE}/oauth/token`, registration_endpoint: `${SITE}/oauth/register`, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
    expect(server).not.toHaveProperty('client_id_metadata_document_supported');
  });

  test('registers public clients with HTTPS or loopback redirect URIs only', async () => {
    const { register, reg } = await oauthSetup();
    expect(reg).toMatchObject({ client_name: 'Test Agent', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' });
    for (const uri of ['cursor://anysphere/callback', 'http://example.com/cb', 'https://example.com/cb#frag', 'javascript:alert(1)'])
      expect((await register({ redirect_uris: [uri] })).status).toBe(400);
    expect((await register({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'client_secret_basic' })).status).toBe(400);
    expect((await register({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] })).status).toBe(201);
  });

  test('never redirects for an unknown client or unregistered redirect URI, and redirects other errors', async () => {
    const { authorize, t } = await oauthSetup();
    const { challenge } = pkce();
    const unknown = await t.fetch(`/oauth/authorize?client_id=nope&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code`, { method: 'GET' });
    expect(unknown.status).toBe(400);
    expect(unknown.headers.get('Location')).toBeNull();
    const wrongRedirect = await authorize({ code_challenge: challenge, redirect_uri: 'http://127.0.0.1:1/other' });
    expect(wrongRedirect.status).toBe(400);
    const errorOf = async (res: Response) => new URL(res.headers.get('Location')!).searchParams.get('error');
    expect(await errorOf(await authorize({ code_challenge: challenge, code_challenge_method: 'plain' }))).toBe('invalid_request');
    expect(await errorOf(await authorize({ code_challenge: challenge, resource: 'https://evil.example/mcp' }))).toBe('invalid_target');
    expect(await errorOf(await authorize({ code_challenge: challenge, scope: 'messages:read admin' }))).toBe('invalid_scope');
  });

  test('completes the code flow with PKCE, scoped consent and a working MCP token', async () => {
    const { owner, consent, exchange, rpc, tool, spaceId, otherSpace } = await oauthSetup();
    const { code, verifier } = await consent({ scopes: ['messages:read'], spaceMode: 'selected', spaceIds: [spaceId] });
    expect(await owner.query(api.agents.list)).toEqual([]); // pending until exchanged
    const res = await exchange(code, verifier);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const tokens = await res.json();
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'messages:read' });
    expect((await rpc(tokens.access_token, 'tools/list')).body.result.tools.map((t: { name: string }) => t.name)).not.toContain('send_message');
    expect((await tool(tokens.access_token, 'read_messages', { space_id: spaceId })).data).toBeTruthy();
    expect(await tool(tokens.access_token, 'read_messages', { space_id: otherSpace })).toMatchObject({ isError: true });
    expect(await tool(tokens.refresh_token, 'whoami')).toMatchObject({ status: 401 });
    const [listed] = await owner.query(api.agents.list);
    expect(listed).toMatchObject({ kind: 'oauth', clientName: 'Test Agent', redirectHost: '127.0.0.1:33418', requestedScopes: ALL });
  });

  test('consent offers every scope by default, grants only what the person approves, never more than requested', async () => {
    const { owner, authorize, consent, exchange } = await oauthSetup();
    const { challenge } = pkce();
    const location = new URL((await authorize({ code_challenge: challenge, scope: 'messages:read' })).headers.get('Location')!);
    const requestId = location.searchParams.get('authorize')!;
    expect(await owner.query(api.agents.consentRequest, { requestId })).toMatchObject({ status: 'ready', clientName: 'Test Agent', redirectHost: '127.0.0.1:33418', requestedScopes: ['messages:read'] });
    await expect(owner.action(api.agents.approve, { requestId, name: 'Test', scopes: ['messages:send'], spaceMode: 'all', spaceIds: [] })).rejects.toThrow('didn’t ask');
    // Omitted scope: all are requested, so the person may later turn on more in Common.
    const { code, verifier } = await consent({ scopes: ['messages:read'] });
    await exchange(code, verifier);
    const [connection] = await owner.query(api.agents.list);
    await owner.mutation(api.agents.update, { connectionId: connection.id as Id<'agentConnections'>, name: 'Test', scopes: ALL, spaceMode: 'all', spaceIds: [] });
    // A profile-only grant with no spaces is valid.
    const second = await consent({ scopes: ['profile:write'], spaceMode: 'selected', spaceIds: [] });
    expect((await (await exchange(second.code, second.verifier)).json()).scope).toBe('profile:write');
  });

  test('binds codes to client, redirect URI, verifier and resource, and spends them once', async () => {
    const { consent, exchange, register, tool } = await oauthSetup();
    const { code, verifier } = await consent();
    const other = await (await register({ redirect_uris: [REDIRECT] })).json();
    expect((await exchange(code, pkce().verifier)).status).toBe(400);
    expect((await exchange(code, verifier, { client_id: other.client_id })).status).toBe(400);
    expect((await exchange(code, verifier, { redirect_uri: 'http://127.0.0.1:9/x' })).status).toBe(400);
    expect(await (await exchange(code, verifier, { resource: 'https://evil.example/mcp' })).json()).toMatchObject({ error: 'invalid_target' });
    const missing = await exchange(code, verifier, { resource: '' });
    expect(missing.status).toBe(400);
    // None of the failures above spent the code.
    const tokens = await (await exchange(code, verifier)).json();
    expect((await tool(tokens.access_token, 'whoami')).data).toBeTruthy();
    // Replaying it revokes the grant, and that revocation sticks.
    expect(await (await exchange(code, verifier)).json()).toMatchObject({ error: 'invalid_grant' });
    expect((await tool(tokens.access_token, 'whoami')).status).toBe(401);
  });

  test('rotates refresh tokens and revokes the grant when an old one is replayed', async () => {
    const { consent, exchange, tokenRequest, tool } = await oauthSetup();
    const { code, verifier } = await consent();
    const first = await (await exchange(code, verifier)).json();
    const refresh = (token: string, extra: Record<string, string> = {}) => tokenRequest({ grant_type: 'refresh_token', refresh_token: token, ...extra });
    expect(await (await refresh(first.refresh_token, { resource: 'https://evil.example/mcp' })).json()).toMatchObject({ error: 'invalid_target' });
    expect(await (await refresh(first.refresh_token, { scope: 'messages:read' })).json()).toMatchObject({ error: 'invalid_scope' });
    const second = await (await refresh(first.refresh_token, { resource: RESOURCE })).json();
    const third = await (await refresh(second.refresh_token)).json();
    expect(third.scope).toBe('messages:read messages:send');
    expect((await tool(third.access_token, 'whoami')).data).toBeTruthy();
    expect(await (await refresh(first.refresh_token)).json()).toMatchObject({ error: 'invalid_grant' });
    expect((await tool(third.access_token, 'whoami')).status).toBe(401);
    expect(await (await refresh(third.refresh_token)).json()).toMatchObject({ error: 'invalid_grant' });
  });

  test('refresh stops for deleted or unverified people', async () => {
    const { t, ids, consent, exchange, tokenRequest } = await oauthSetup();
    const { code, verifier } = await consent();
    const tokens = await (await exchange(code, verifier)).json();
    await t.run(ctx => ctx.db.patch(ids.owner, { emailVerificationTime: undefined }));
    expect(await (await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })).json()).toMatchObject({ error: 'invalid_grant' });
  });

  test('denying returns access_denied; expired requests are reported, not looped', async () => {
    const { t, owner, authorize } = await oauthSetup();
    const { challenge } = pkce();
    const requestId = new URL((await authorize({ code_challenge: challenge })).headers.get('Location')!).searchParams.get('authorize')!;
    const { redirectUrl } = await owner.mutation(api.agents.deny, { requestId });
    expect(new URL(redirectUrl!).searchParams.get('error')).toBe('access_denied');
    expect(await owner.query(api.agents.consentRequest, { requestId })).toEqual({ status: 'expired' });
    const again = new URL((await authorize({ code_challenge: challenge })).headers.get('Location')!).searchParams.get('authorize')!;
    await t.run(async ctx => {
      const row = await ctx.db.query('oauthRequests').withIndex('by_request', q => q.eq('requestId', again)).unique();
      await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1 });
    });
    expect(await owner.query(api.agents.consentRequest, { requestId: again })).toEqual({ status: 'expired' });
    await expect(owner.action(api.agents.approve, { requestId: again, name: 'x', scopes: [], spaceMode: 'all', spaceIds: [] })).rejects.toThrow('expired');
  });

  test('sweeps expired requests and old codes, keeping live ones and replay detection', async () => {
    const { t, authorize, consent, exchange, tool } = await oauthSetup();
    const requestIdOf = async () => new URL((await authorize({ code_challenge: pkce().challenge })).headers.get('Location')!).searchParams.get('authorize')!;
    const live = await requestIdOf();
    const stale = await requestIdOf();
    const used = await consent();
    const tokens = await (await exchange(used.code, used.verifier)).json();
    const old = await consent();
    const hour = 60 * 60_000;
    await t.run(async ctx => {
      const request = await ctx.db.query('oauthRequests').withIndex('by_request', q => q.eq('requestId', stale)).unique();
      await ctx.db.patch(request!._id, { expiresAt: Date.now() - 1 });
      const codes = await ctx.db.query('oauthCodes').collect();
      // The exchanged code just expired (still inside the replay window); the unused one is long gone.
      await ctx.db.patch(codes.find(c => c.usedAt)!._id, { expiresAt: Date.now() - 1 });
      await ctx.db.patch(codes.find(c => !c.usedAt)!._id, { expiresAt: Date.now() - hour - 1 });
    });
    await requestIdOf(); // any new authorization request sweeps
    const left = await t.run(async ctx => ({ requests: (await ctx.db.query('oauthRequests').collect()).map(r => r.requestId), codes: await ctx.db.query('oauthCodes').collect() }));
    expect(left.requests).toContain(live);
    expect(left.requests).not.toContain(stale);
    expect(left.codes).toHaveLength(1);
    expect(left.codes[0].usedAt).toBeDefined();
    expect(await (await exchange(old.code, old.verifier)).json()).toMatchObject({ error: 'invalid_grant' });
    // Replaying the retained used code still revokes its grant.
    expect(await (await exchange(used.code, used.verifier)).json()).toMatchObject({ error: 'invalid_grant' });
    expect((await tool(tokens.access_token, 'whoami')).status).toBe(401);
  });

  test('token revocation endpoint ends the grant', async () => {
    const { t, reg, consent, exchange, tool } = await oauthSetup();
    const { code, verifier } = await consent();
    const tokens = await (await exchange(code, verifier)).json();
    const res = await t.fetch('/oauth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokens.refresh_token, client_id: reg.client_id }).toString() });
    expect(res.status).toBe(200);
    expect((await tool(tokens.access_token, 'whoami')).status).toBe(401);
  });
});

describe('OAuth token throttling', () => {
  const junkCode = () => 'x'.repeat(10) + randomBytes(16).toString('base64url');
  const throttledOk = async (res: Response) => {
    expect(res.status).toBe(429);
    const retry = Number(res.headers.get('Retry-After'));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60);
    expect(await res.json()).toMatchObject({ error: 'temporarily_unavailable' });
  };

  test('junk under a public client_id is answered 429 and never locks out a valid grant', async () => {
    const { consent, exchange, tokenRequest, tool } = await oauthSetup();
    const { code, verifier } = await consent();
    const { verifier: junkVerifier } = pkce();
    for (let i = 0; i < TOKEN_MISS_LIMIT.max; i++) expect(await (await exchange(junkCode(), junkVerifier)).json()).toMatchObject({ error: 'invalid_grant' });
    await throttledOk(await exchange(junkCode(), junkVerifier));
    await throttledOk(await tokenRequest({ grant_type: 'refresh_token', refresh_token: 'cmn_rt_' + junkCode() }));
    // The real code and its refresh token still work while the junk bucket is full.
    const tokens = await (await exchange(code, verifier)).json();
    expect(tokens.access_token).toBeTruthy();
    const next = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    expect(next.status).toBe(200);
    expect((await tool((await next.json()).access_token, 'whoami')).data).toBeTruthy();
  });

  test('made-up client_ids share one bucket instead of one row each', async () => {
    const { t } = await oauthSetup();
    for (let i = 0; i < 5; i++) {
      await t.fetch('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: `nope-${i}`, grant_type: 'refresh_token', refresh_token: junkCode() }).toString() });
    }
    const keys = await t.run(async ctx => (await ctx.db.query('rateLimits').collect()).map(r => r.key).filter(k => k.startsWith('oauth-token:')));
    expect(keys).toEqual(['oauth-token:miss:unregistered']);
  });

  test('hammering one grant is throttled with 429, and the grant survives it', async () => {
    const { t, consent, exchange, tokenRequest } = await oauthSetup();
    const { code, verifier } = await consent();
    const tokens = await (await exchange(code, verifier)).json();
    // The code exchange counted once; bound-but-rejected refreshes count against the same grant.
    for (let i = 1; i < TOKEN_GRANT_LIMIT.max; i++) expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, scope: 'messages:read' })).status).toBe(400);
    await throttledOk(await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }));
    // Once the window passes, the same (unrotated) refresh token still works: throttling never revokes.
    await t.run(async ctx => {
      for (const row of await ctx.db.query('rateLimits').collect()) await ctx.db.patch(row._id, { start: Date.now() - TOKEN_GRANT_LIMIT.windowMs });
    });
    expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })).status).toBe(200);
  });

  test('a replayed refresh token still revokes the grant while it is throttled', async () => {
    const { consent, exchange, tokenRequest, tool } = await oauthSetup();
    const { code, verifier } = await consent();
    const first = await (await exchange(code, verifier)).json();
    const second = await (await tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token })).json();
    for (let i = 2; i < TOKEN_GRANT_LIMIT.max; i++) await tokenRequest({ grant_type: 'refresh_token', refresh_token: second.refresh_token, scope: 'messages:read' });
    await throttledOk(await tokenRequest({ grant_type: 'refresh_token', refresh_token: second.refresh_token }));
    expect(await (await tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token })).json()).toMatchObject({ error: 'invalid_grant' });
    expect((await tool(second.access_token, 'whoami')).status).toBe(401);
  });
});
