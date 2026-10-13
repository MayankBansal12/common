import { internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { rateLimit, takeRateLimit } from './lib/access';
import { ACCESS_TTL, SCOPES, REFRESH_TTL, REQUEST_TTL, revokeConnection } from './lib/agents';

/**
 * OAuth 2.1 storage for MCP clients (public clients only, PKCE S256, exact redirect URIs).
 * Secrets are generated and hashed in the HTTP action; these mutations only ever see hashes.
 * Failures that must persist (revoking a grant on code or refresh-token reuse) are returned rather
 * than thrown, so the revocation commits.
 */
type TokenResult =
  | { ok: true; scope: string; expiresIn: number }
  | { ok: false; error: 'invalid_grant' | 'invalid_target' | 'invalid_scope' | 'invalid_client'; description: string }
  | { ok: false; error: 'rate_limited'; description: string; retryAfter: number };

/**
 * Token endpoint throttling. A request that presents a real, correctly bound code or refresh token is
 * counted against its own grant, so junk sent under the same (public) client_id can never lock it out.
 * Everything else counts against a shared "miss" bucket for that client.
 */
export const TOKEN_GRANT_LIMIT = { max: 20, windowMs: 60_000 };
export const TOKEN_MISS_LIMIT = { max: 30, windowMs: 60_000 };
const limited = (ms: number): TokenResult => ({ ok: false, error: 'rate_limited', description: 'Too many attempts. Try again shortly.', retryAfter: Math.ceil(ms / 1000) });
async function grantThrottle(ctx: MutationCtx, connectionId: string) {
  const wait = await takeRateLimit(ctx, `oauth-token:grant:${connectionId}`, TOKEN_GRANT_LIMIT.max, TOKEN_GRANT_LIMIT.windowMs);
  return wait ? limited(wait) : null;
}
/** Unregistered client_ids share one bucket so junk can't mint a rate-limit row per made-up id. */
async function missThrottle(ctx: MutationCtx, clientId: string) {
  const known = await ctx.db.query('oauthClients').withIndex('by_client', q => q.eq('clientId', clientId)).unique();
  const wait = await takeRateLimit(ctx, known ? `oauth-token:miss:${clientId}` : 'oauth-token:miss:unregistered', TOKEN_MISS_LIMIT.max, TOKEN_MISS_LIMIT.windowMs);
  return wait ? limited(wait) : null;
}

export const client = internalQuery({ args: { clientId: v.string() }, handler: async (ctx, { clientId }) => {
  const row = await ctx.db.query('oauthClients').withIndex('by_client', q => q.eq('clientId', clientId)).unique();
  return row ? { name: row.name, redirectUris: row.redirectUris } : null;
}});

/** Throttles anonymous endpoints. Returns false (instead of throwing) so callers can answer 429. */
async function allow(ctx: MutationCtx, key: string, max: number, windowMs: number) {
  try {
    await rateLimit(ctx, key, max, windowMs);
    return true;
  } catch {
    return false;
  }
}

export const register = internalMutation({ args: { clientId: v.string(), name: v.string(), redirectUris: v.array(v.string()), source: v.string() }, handler: async (ctx, args) => {
  if (!(await allow(ctx, `oauth-register:${args.source}`, 20, 3_600_000)) || !(await allow(ctx, 'oauth-register', 1_000, 3_600_000))) return false;
  await ctx.db.insert('oauthClients', { clientId: args.clientId, name: args.name, redirectUris: args.redirectUris });
  return true;
}});

export const startRequest = internalMutation({ args: { requestId: v.string(), clientId: v.string(), redirectUri: v.string(), codeChallenge: v.string(), state: v.optional(v.string()), scopes: v.array(v.string()), resource: v.string() }, handler: async (ctx, args) => {
  const row = await ctx.db.query('oauthClients').withIndex('by_client', q => q.eq('clientId', args.clientId)).unique();
  if (!row || !row.redirectUris.includes(args.redirectUri)) return false;
  if (!(await allow(ctx, `oauth-authorize:${args.clientId}`, 30, 600_000))) return false;
  await sweepExpired(ctx);
  await ctx.db.insert('oauthRequests', { ...args, // No scope requested: everything is on offer, and consent still starts with only reading and sending checked.
    scopes: args.scopes.length ? args.scopes : [...SCOPES], expiresAt: Date.now() + REQUEST_TTL });
  return true;
}});

export const exchangeCode = internalMutation({ args: { codeHash: v.string(), clientId: v.string(), redirectUri: v.string(), challenge: v.string(), resource: v.string(), accessHash: v.string(), refreshHash: v.string() }, handler: async (ctx, args): Promise<TokenResult> => {
  const invalid = { ok: false, error: 'invalid_grant', description: 'The authorization code is invalid or expired.' } as const;
  const code = await ctx.db.query('oauthCodes').withIndex('by_hash', q => q.eq('hash', args.codeHash)).unique();
  // Bindings are checked first, so a wrong client, redirect URI or verifier neither spends a valid
  // code nor lets an unrelated client trigger revocation of someone else's grant.
  if (!code || code.clientId !== args.clientId || code.redirectUri !== args.redirectUri || code.codeChallenge !== args.challenge) return (await missThrottle(ctx, args.clientId)) ?? invalid;
  if (code.resource !== args.resource) return { ok: false, error: 'invalid_target', description: 'The resource does not match the authorization request.' };
  const connection = await ctx.db.get(code.connectionId);
  if (code.usedAt) {
    // A replayed code may have been intercepted: revoke everything it issued (RFC 6749 §4.1.2).
    if (connection) await revokeConnection(ctx, connection);
    return invalid;
  }
  const throttled = await grantThrottle(ctx, code.connectionId);
  if (throttled) return throttled;
  await ctx.db.patch(code._id, { usedAt: Date.now() });
  if (code.expiresAt <= Date.now() || !connection || !(await liveOwner(ctx, connection))) return invalid;
  await ctx.db.patch(connection._id, { pending: false });
  const now = Date.now();
  await ctx.db.insert('agentTokens', { connectionId: connection._id, hash: args.accessHash, kind: 'access', expiresAt: now + ACCESS_TTL });
  await ctx.db.insert('agentTokens', { connectionId: connection._id, hash: args.refreshHash, kind: 'refresh', expiresAt: now + REFRESH_TTL });
  return { ok: true, scope: connection.scopes.join(' '), expiresIn: ACCESS_TTL / 1000 };
}});

/**
 * Refresh tokens rotate. Rotated tokens are kept (marked `replacedAt`) until they expire, so replaying
 * any earlier token of the grant revokes it. Scope follows the person's current grant; a client
 * can't narrow or widen it here (narrowing is rejected rather than silently ignored).
 */
export const refresh = internalMutation({ args: { refreshHash: v.string(), clientId: v.string(), resource: v.optional(v.string()), expectedResource: v.string(), scopes: v.optional(v.array(v.string())), accessHash: v.string(), newRefreshHash: v.string() }, handler: async (ctx, args): Promise<TokenResult> => {
  const invalid = { ok: false, error: 'invalid_grant', description: 'The refresh token is invalid or expired.' } as const;
  const token = await ctx.db.query('agentTokens').withIndex('by_hash', q => q.eq('hash', args.refreshHash)).unique();
  const connection = token?.kind === 'refresh' ? await ctx.db.get(token.connectionId) : null;
  if (!token || !connection || connection.pending || connection.clientId !== args.clientId) return (await missThrottle(ctx, args.clientId)) ?? invalid;
  if (token.replacedAt) {
    // Replay always revokes, before any throttling, so a thief can't dodge it by hammering.
    await revokeConnection(ctx, connection);
    return invalid;
  }
  const throttled = await grantThrottle(ctx, connection._id);
  if (throttled) return throttled;
  const now = Date.now();
  if ((token.expiresAt !== undefined && token.expiresAt <= now) || !(await liveOwner(ctx, connection))) return invalid;
  if (args.resource !== undefined && args.resource !== args.expectedResource) return { ok: false, error: 'invalid_target', description: 'The resource does not match this grant.' };
  if (args.scopes && (args.scopes.length !== connection.scopes.length || args.scopes.some(s => !connection.scopes.includes(s)))) return { ok: false, error: 'invalid_scope', description: 'Refreshing keeps the permissions the person granted; change them in Common.' };
  // Bounded cleanup, oldest first: tokens past their expiry are no longer needed for anything.
  for (const old of await ctx.db.query('agentTokens').withIndex('by_connection', q => q.eq('connectionId', connection._id)).take(50)) {
    if (old.expiresAt !== undefined && old.expiresAt <= now) await ctx.db.delete(old._id);
  }
  await ctx.db.patch(token._id, { replacedAt: now });
  await ctx.db.insert('agentTokens', { connectionId: connection._id, hash: args.accessHash, kind: 'access', expiresAt: now + ACCESS_TTL });
  await ctx.db.insert('agentTokens', { connectionId: connection._id, hash: args.newRefreshHash, kind: 'refresh', expiresAt: now + REFRESH_TTL });
  return { ok: true, scope: connection.scopes.join(' '), expiresIn: ACCESS_TTL / 1000 };
}});

/**
 * Opportunistic, bounded cleanup on each new authorization request (oldest first via expiry indexes).
 * Pending requests go once expired. Codes are kept CODE_REPLAY_WINDOW past expiry, so a replayed code
 * still revokes the grant it issued for as long as that grant's first access token could be live.
 */
export const SWEEP_BATCH = 25;
export const CODE_REPLAY_WINDOW = ACCESS_TTL;
async function sweepExpired(ctx: MutationCtx) {
  const now = Date.now();
  for (const row of await ctx.db.query('oauthRequests').withIndex('by_expiry', q => q.lte('expiresAt', now)).take(SWEEP_BATCH)) await ctx.db.delete(row._id);
  for (const row of await ctx.db.query('oauthCodes').withIndex('by_expiry', q => q.lte('expiresAt', now - CODE_REPLAY_WINDOW)).take(SWEEP_BATCH)) await ctx.db.delete(row._id);
}

/** The grant is unexpired and its person still exists with a verified email. */
async function liveOwner(ctx: MutationCtx, connection: Doc<'agentConnections'>) {
  if (connection.expiresAt !== undefined && connection.expiresAt <= Date.now()) return false;
  const user = await ctx.db.get(connection.userId);
  return Boolean(user?.email && user.emailVerificationTime);
}

/** RFC 7009. Revoking a refresh token ends the grant; revoking an access token ends just that token. */
export const revoke = internalMutation({ args: { hash: v.string(), clientId: v.optional(v.string()) }, handler: async (ctx, { hash, clientId }) => {
  const token = await ctx.db.query('agentTokens').withIndex('by_hash', q => q.eq('hash', hash)).unique();
  if (!token || token.kind === 'personal') return;
  const connection = await ctx.db.get(token.connectionId);
  if (!connection || (clientId !== undefined && connection.clientId !== clientId)) return;
  if (token.kind === 'refresh') await revokeConnection(ctx, connection);
  else await ctx.db.delete(token._id);
}});
