import { httpAction, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import { ConvexError } from 'convex/values';
import { allowedFor, TOOLS, toolByName } from './mcp';
import { base64url, hashSecret, isScope, issuer, mcpResource, randomSecret, SCOPES, sha256, TOKEN_PATTERN, type AgentFailure } from './lib/agents';

/**
 * Hosted MCP server (stateless Streamable HTTP, JSON responses) and the OAuth 2.1 endpoints it uses.
 * Issuer and resource always come from CONVEX_SITE_URL, never from the request's Host.
 */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const LATEST = PROTOCOL_VERSIONS[0];
const MAX_BODY = 256 * 1024;
const SERVER_INFO = { name: 'common', title: 'Common', version: '0.1.0' };
const INSTRUCTIONS = 'Common is a group chat for people and their agents. You act for one verified person; everything you send is shown as you, an agent acting for them. Call whoami first to see who that is and what you may do. Use catch_up to see what’s new since you last checked (it never marks anything read for the person), list_spaces to find spaces, read_messages to page through a space, search_messages to find earlier messages, and send_message with a fresh request_id per message.';

// ---- Origins and CORS -------------------------------------------------------------------------

/** Browsers send Origin; it must be the app itself or explicitly allowed. Server-side clients send none. */
function originAllowed(origin: string | null) {
  if (!origin) return true;
  const allowed = [process.env.SITE_URL, ...(process.env.MCP_ALLOWED_ORIGINS ?? '').split(',')].map(o => o?.trim().replace(/\/+$/, '')).filter(Boolean);
  return allowed.includes(origin);
}
function cors(origin: string | null, extra: Record<string, string> = {}): Record<string, string> {
  return origin && originAllowed(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Protocol-Version', ...extra }
    : { Vary: 'Origin', ...extra };
}
/** Metadata, registration and token endpoints hold no cookies or ambient authority, so any origin may read them. */
const OPEN_CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}

export const mcpPreflight = httpAction(async (_ctx, request) => {
  const origin = request.headers.get('Origin');
  if (!originAllowed(origin)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: cors(origin, { 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID', 'Access-Control-Max-Age': '600' }) });
});
export const openPreflight = httpAction(async () => new Response(null, { status: 204, headers: { ...OPEN_CORS, 'Access-Control-Max-Age': '600' } }));

// ---- Bearer authentication --------------------------------------------------------------------

const resourceMetadataUrl = () => `${issuer()}/.well-known/oauth-protected-resource/mcp`;
function challenge(origin: string | null, status: 401 | 403, params: Record<string, string>) {
  const header = `Bearer ${Object.entries({ resource_metadata: resourceMetadataUrl(), ...params }).map(([k, v]) => `${k}="${v.replace(/[^\x20-\x7e]|"/g, '')}"`).join(', ')}`;
  return json({ error: params.error ?? 'invalid_token', error_description: params.error_description ?? 'Connect this agent to Common first.' }, status, cors(origin, { 'WWW-Authenticate': header }));
}
// The challenge lists every permission Common can grant, so a client requests all of them and the
// person decides on the consent screen (only reading and sending start checked).
const unauthorized = (origin: string | null, provided: boolean) => challenge(origin, 401, provided
  ? { error: 'invalid_token', error_description: 'This connection is no longer valid. Reconnect the agent in Common.', scope: SCOPES.join(' ') }
  : { scope: SCOPES.join(' ') });

type Gate = { tokenHash: string; scopes: string[] };
/** Returns the caller's grant, or the HTTP response to send instead. */
async function authenticate(ctx: ActionCtx, request: Request): Promise<Gate | Response> {
  const origin = request.headers.get('Origin');
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return unauthorized(origin, false);
  if (!TOKEN_PATTERN.test(match[1])) return unauthorized(origin, true);
  const tokenHash = await hashSecret(match[1]);
  try {
    const { scopes } = await ctx.runMutation(internal.mcp.gate, { tokenHash });
    return { tokenHash, scopes };
  } catch (e) {
    if (failure(e)?.code === 'invalid_token') return unauthorized(origin, true);
    const text = businessMessage(e);
    if (text) return json({ error: 'rate_limited', error_description: text }, 429, cors(origin, { 'Retry-After': '30' }));
    throw e;
  }
}
/** Structured grant failures. Across ctx.run* calls ConvexError data may arrive JSON-encoded, so decode both forms. */
function failure(e: unknown): AgentFailure | null {
  if (!(e instanceof ConvexError)) return null;
  let data: unknown = e.data;
  if (typeof data === 'string' && data.startsWith('{')) {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const { code, scope } = data as { code?: unknown; scope?: unknown };
  if (code === 'invalid_token') return { code };
  if (code === 'insufficient_scope' && typeof scope === 'string' && isScope(scope)) return { code, scope };
  return null;
}
/** A plain business message (not a structured failure). */
const businessMessage = (e: unknown) => (e instanceof ConvexError && typeof e.data === 'string' && !failure(e) ? e.data : null);

// ---- MCP --------------------------------------------------------------------------------------

type JsonRpcId = string | number;
const rpcError = (id: JsonRpcId | null, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** GET would open a server-sent event stream and DELETE would end a session; this server keeps neither. */
export const mcpOther = httpAction(async (ctx, request) => {
  const origin = request.headers.get('Origin');
  if (!originAllowed(origin)) return new Response('Forbidden origin', { status: 403 });
  const auth = await authenticate(ctx, request);
  if (auth instanceof Response) return auth;
  return new Response(null, { status: 405, headers: cors(origin, { Allow: 'POST' }) });
});

export const mcpPost = httpAction(async (ctx, request) => {
  const origin = request.headers.get('Origin');
  if (!originAllowed(origin)) return json(rpcError(null, -32600, 'Forbidden origin.'), 403);
  const headers = cors(origin);
  const version = request.headers.get('MCP-Protocol-Version');
  if (version && !PROTOCOL_VERSIONS.includes(version)) return json(rpcError(null, -32600, `Unsupported MCP-Protocol-Version. Supported: ${PROTOCOL_VERSIONS.join(', ')}.`), 400, headers);
  const text = await request.text();
  if (text.length > MAX_BODY) return json(rpcError(null, -32600, 'Request too large.'), 413, headers);
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return json(rpcError(null, -32700, 'Parse error.'), 400, headers);
  }
  if (Array.isArray(message) || !message || typeof message !== 'object') return json(rpcError(null, -32600, 'Send one JSON-RPC message per request.'), 400, headers);
  const msg = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  const hasId = typeof msg.id === 'string' || typeof msg.id === 'number';
  if (msg.jsonrpc !== '2.0' || (msg.id !== undefined && !hasId) || (msg.method !== undefined && typeof msg.method !== 'string')) return json(rpcError(null, -32600, 'Invalid request.'), 400, headers);

  const auth = await authenticate(ctx, request);
  if (auth instanceof Response) return auth;
  // Notifications and responses need no reply.
  if (!hasId || msg.method === undefined) return new Response(null, { status: 202, headers });
  const id = msg.id as JsonRpcId;
  const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<string, unknown>;
  const reply = (result: unknown) => json({ jsonrpc: '2.0', id, result }, 200, headers);

  switch (msg.method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : LATEST;
      return reply({ protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      // Discovery shows only what this grant allows.
      return reply({ tools: TOOLS.filter(t => allowedFor(t, auth.scopes)).map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })) });
    case 'tools/call': {
      const name = params.name;
      const args = params.arguments ?? {};
      const tool = typeof name === 'string' ? toolByName(name) : undefined;
      if (!tool) return json(rpcError(id, -32602, `Unknown tool: ${String(name)}.`), 200, headers);
      if (!args || typeof args !== 'object' || Array.isArray(args)) return reply(toolError('"arguments" must be an object.'));
      if (!allowedFor(tool, auth.scopes)) return insufficient(origin, tool.scopes![0]);
      try {
        const result = tool.write
          ? await ctx.runMutation(internal.mcp.write, { tokenHash: auth.tokenHash, name: tool.name, args })
          : await ctx.runQuery(internal.mcp.read, { tokenHash: auth.tokenHash, name: tool.name, args });
        return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false });
      } catch (e) {
        // The grant may have changed since the gate: the call itself re-checks and wins.
        const f = failure(e);
        if (f?.code === 'invalid_token') return unauthorized(origin, true);
        if (f?.code === 'insufficient_scope') return insufficient(origin, f.scope);
        const text = businessMessage(e);
        if (text) return reply(toolError(text));
        console.error('MCP tool failed', tool.name, e instanceof Error ? e.message : 'unknown');
        return reply(toolError('Something went wrong. Please try again.'));
      }
    }
    default:
      return json(rpcError(id, -32601, `Method not found: ${msg.method}.`), 200, headers);
  }
});
const toolError = (text: string) => ({ content: [{ type: 'text', text }], isError: true });
const insufficient = (origin: string | null, scope: string) => challenge(origin, 403, { error: 'insufficient_scope', scope, error_description: 'This connection does not have that permission. The person can change it in Common.' });

// ---- OAuth metadata ---------------------------------------------------------------------------

export const protectedResource = httpAction(async () => json({
  resource: mcpResource(),
  authorization_servers: [issuer()],
  scopes_supported: [...SCOPES],
  bearer_methods_supported: ['header'],
  resource_name: 'Common',
}, 200, OPEN_CORS));

export const authorizationServer = httpAction(async () => {
  const base = issuer();
  return json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: [...SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
  }, 200, OPEN_CORS);
});

// ---- Dynamic client registration (public clients) ---------------------------------------------

/** HTTPS anywhere, or plain HTTP to this machine only (RFC 8252 loopback). No fragments or credentials. */
export function validRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}
const cleanClientName = (value: unknown) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) : '') || 'MCP client';

export const register = httpAction(async (ctx, request) => {
  const fail = (description: string, error = 'invalid_client_metadata') => json({ error, error_description: description }, 400, OPEN_CORS);
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 16_384) return fail('Registration too large.');
    body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
  } catch {
    return fail('Send client metadata as a JSON object.');
  }
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 5) return fail('Provide between one and five redirect_uris.', 'invalid_redirect_uri');
  if (!uris.every(validRedirectUri)) return fail('Redirect URIs must use HTTPS, or HTTP to localhost.', 'invalid_redirect_uri');
  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') return fail('Only public clients are supported (token_endpoint_auth_method "none").');
  const grants = body.grant_types ?? ['authorization_code', 'refresh_token'];
  if (!Array.isArray(grants) || grants.some(g => g !== 'authorization_code' && g !== 'refresh_token')) return fail('Supported grant_types: authorization_code, refresh_token.');
  const responses = body.response_types ?? ['code'];
  if (!Array.isArray(responses) || responses.some(r => r !== 'code')) return fail('Supported response_types: code.');
  const clientId = randomSecret('cmn_client_', 18);
  const name = cleanClientName(body.client_name);
  const source = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
  if (!(await ctx.runMutation(internal.oauth.register, { clientId, name, redirectUris: uris as string[], source }))) return json({ error: 'temporarily_unavailable', error_description: 'Too many registrations. Try again later.' }, 429, OPEN_CORS);
  return json({ client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris: uris, grant_types: grants, response_types: ['code'], token_endpoint_auth_method: 'none' }, 201, OPEN_CORS);
});

// ---- Authorization endpoint -------------------------------------------------------------------

function page(status: number, title: string, body: string) {
  const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Common</title><body style="font-family:system-ui,sans-serif;max-width:420px;margin:18vh auto;padding:0 24px;color:#2b2a27;line-height:1.5"><h1 style="font-size:20px">${esc(title)}</h1><p>${esc(body)}</p></body>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Frame-Options': 'DENY' } });
}
function redirect(location: string) {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}
function errorRedirect(redirectUri: string, error: string, description: string, state: string | null) {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  url.searchParams.set('iss', issuer());
  return redirect(url.toString());
}

export const authorize = httpAction(async (ctx, request) => {
  const q = new URL(request.url).searchParams;
  const clientId = q.get('client_id') ?? '';
  const redirectUri = q.get('redirect_uri') ?? '';
  // Until the client and its exact redirect URI check out, never redirect anywhere.
  const client = clientId.length <= 100 ? await ctx.runQuery(internal.oauth.client, { clientId }) : null;
  if (!client) return page(400, 'Unknown app', 'This connection request came from an app Common doesn’t recognise. Start connecting again from your agent.');
  if (!client.redirectUris.includes(redirectUri)) return page(400, 'Invalid return address', 'This connection request doesn’t match the app’s registered return address.');
  const state = q.get('state');
  if (state && state.length > 1000) return errorRedirect(redirectUri, 'invalid_request', 'state is too long.', null);
  if (q.get('response_type') !== 'code') return errorRedirect(redirectUri, 'unsupported_response_type', 'Only response_type=code is supported.', state);
  const codeChallenge = q.get('code_challenge') ?? '';
  if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) return errorRedirect(redirectUri, 'invalid_request', 'PKCE with code_challenge_method=S256 is required.', state);
  if (q.get('resource') !== mcpResource()) return errorRedirect(redirectUri, 'invalid_target', `resource must be ${mcpResource()}.`, state);
  const requested = (q.get('scope') ?? '').split(' ').filter(Boolean);
  if (requested.some(s => !isScope(s))) return errorRedirect(redirectUri, 'invalid_scope', `Supported scopes: ${SCOPES.join(' ')}.`, state);
  const site = process.env.SITE_URL?.replace(/\/+$/, '');
  if (!site) return page(500, 'Not set up yet', 'This Common server isn’t configured for connecting agents yet.');
  const requestId = randomSecret('', 24);
  const ok = await ctx.runMutation(internal.oauth.startRequest, { requestId, clientId, redirectUri, codeChallenge, state: state ?? undefined, scopes: [...new Set(requested)], resource: mcpResource() });
  if (!ok) return errorRedirect(redirectUri, 'temporarily_unavailable', 'Too many requests. Try again shortly.', state);
  return redirect(`${site}/?authorize=${encodeURIComponent(requestId)}`);
});

// ---- Token and revocation endpoints -----------------------------------------------------------

async function form(request: Request) {
  const type = request.headers.get('Content-Type') ?? '';
  const text = await request.text();
  if (text.length > 16_384 || !type.startsWith('application/x-www-form-urlencoded')) return null;
  return new URLSearchParams(text);
}
const tokenError = (error: string, description: string, status = 400) => json({ error, error_description: description }, status, { ...OPEN_CORS, Pragma: 'no-cache' });

/** Temporary throttling is a 429 with Retry-After, never an error that tells the client its grant is dead. */
const tokenFailure = (r: { error: string; description: string; retryAfter?: number }) =>
  r.error === 'rate_limited'
    ? json({ error: 'temporarily_unavailable', error_description: r.description }, 429, { ...OPEN_CORS, Pragma: 'no-cache', 'Retry-After': String(r.retryAfter ?? 60) })
    : tokenError(r.error, r.description);

export const token = httpAction(async (ctx, request) => {
  const params = await form(request);
  if (!params) return tokenError('invalid_request', 'Send an application/x-www-form-urlencoded body.');
  if (params.has('client_secret') || request.headers.has('Authorization')) return tokenError('invalid_client', 'Common clients are public; don’t send a client secret.', 401);
  const clientId = params.get('client_id') ?? '';
  if (!clientId || clientId.length > 100) return tokenError('invalid_client', 'client_id is required.', 401);
  const accessToken = randomSecret('cmn_at_');
  const refreshToken = randomSecret('cmn_rt_');
  const issued = (r: { ok: true; scope: string; expiresIn: number }) => json({ access_token: accessToken, token_type: 'Bearer', expires_in: r.expiresIn, refresh_token: refreshToken, scope: r.scope }, 200, { ...OPEN_CORS, Pragma: 'no-cache' });
  const tokenResult = (r: { ok: true; scope: string; expiresIn: number } | { ok: false; error: string; description: string; retryAfter?: number }) => (r.ok ? issued(r) : tokenFailure(r));
  const grant = params.get('grant_type');
  if (grant === 'authorization_code') {
    const code = params.get('code') ?? '';
    const verifier = params.get('code_verifier') ?? '';
    const redirectUri = params.get('redirect_uri') ?? '';
    const resource = params.get('resource');
    if (!code || code.length > 200 || !redirectUri) return tokenError('invalid_request', 'code and redirect_uri are required.');
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return tokenError('invalid_request', 'A valid PKCE code_verifier is required.');
    if (resource !== mcpResource()) return tokenError('invalid_target', `resource must be ${mcpResource()}.`);
    const result = await ctx.runMutation(internal.oauth.exchangeCode, {
      codeHash: await hashSecret(code), clientId, redirectUri, challenge: base64url(await sha256(verifier)), resource,
      accessHash: await hashSecret(accessToken), refreshHash: await hashSecret(refreshToken),
    });
    return tokenResult(result);
  }
  if (grant === 'refresh_token') {
    const refresh = params.get('refresh_token') ?? '';
    if (!refresh || refresh.length > 200) return tokenError('invalid_request', 'refresh_token is required.');
    const scope = params.get('scope');
    const result = await ctx.runMutation(internal.oauth.refresh, {
      refreshHash: await hashSecret(refresh), clientId, resource: params.get('resource') ?? undefined, expectedResource: mcpResource(),
      scopes: scope ? scope.split(' ').filter(Boolean) : undefined, accessHash: await hashSecret(accessToken), newRefreshHash: await hashSecret(refreshToken),
    });
    return tokenResult(result);
  }
  return tokenError('unsupported_grant_type', 'Supported grant types: authorization_code, refresh_token.');
});

export const revoke = httpAction(async (ctx, request) => {
  const params = await form(request);
  if (!params) return tokenError('invalid_request', 'Send an application/x-www-form-urlencoded body.');
  const value = params.get('token') ?? '';
  if (value && value.length <= 200) await ctx.runMutation(internal.oauth.revoke, { hash: await hashSecret(value), clientId: params.get('client_id') ?? undefined });
  // RFC 7009: unknown or already-revoked tokens still get 200.
  return new Response(null, { status: 200, headers: OPEN_CORS });
});
