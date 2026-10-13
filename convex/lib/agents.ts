import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { internal } from '../_generated/api';

// What a person can let an agent do. Reading who they are (whoami) is always included.
export const SCOPES = ['messages:read', 'messages:send', 'spaces:manage', 'profile:write'] as const;
export type Scope = (typeof SCOPES)[number];
export const DEFAULT_SCOPES: Scope[] = ['messages:read', 'messages:send'];
export const SCOPE_LABELS: Record<Scope, string> = {
  'messages:read': 'Read messages',
  'messages:send': 'Send messages',
  'spaces:manage': 'Manage spaces',
  'profile:write': 'Edit profile',
};
export const isScope = (s: string): s is Scope => (SCOPES as readonly string[]).includes(s);

export const ACCESS_TTL = 60 * 60_000;
export const REFRESH_TTL = 30 * 86_400_000;
export const CODE_TTL = 5 * 60_000;
export const REQUEST_TTL = 10 * 60_000;
export const MAX_CONNECTIONS = 25;
export const MAX_GRANT_SPACES = 100;

/** The agent behind an MCP request, checked against its grant and the person's live access. */
export type AgentActor = { user: Doc<'users'>; connection: Doc<'agentConnections'>; agent: { id: Id<'agentConnections'>; name: string } };

/**
 * Errors the HTTP layer maps to protocol responses: `invalid_token` → 401, `insufficient_scope` → 403.
 * Anything else thrown as a string ConvexError is a business error shown to the agent.
 */
export type AgentFailure = { code: 'invalid_token' } | { code: 'insufficient_scope'; scope: Scope };
export const agentFailure = (f: AgentFailure) => new ConvexError(f);

/** Resolves a hashed bearer token to a live grant. Throws `invalid_token` for anything stale. */
export async function agentFromToken(ctx: QueryCtx | MutationCtx, hash: string): Promise<AgentActor> {
  const now = Date.now();
  const token = await ctx.db.query('agentTokens').withIndex('by_hash', q => q.eq('hash', hash)).unique();
  if (!token || token.kind === 'refresh' || (token.expiresAt !== undefined && token.expiresAt <= now)) throw agentFailure({ code: 'invalid_token' });
  const connection = await ctx.db.get(token.connectionId);
  if (!connection || connection.pending || (connection.expiresAt !== undefined && connection.expiresAt <= now)) throw agentFailure({ code: 'invalid_token' });
  const user = await ctx.db.get(connection.userId);
  if (!user || !user.email || !user.emailVerificationTime) throw agentFailure({ code: 'invalid_token' });
  return { user, connection, agent: { id: connection._id, name: connection.name } };
}

export function hasScope(actor: AgentActor, scope: Scope) {
  return actor.connection.scopes.includes(scope);
}
export function requireScope(actor: AgentActor, scope: Scope) {
  if (!hasScope(actor, scope)) throw agentFailure({ code: 'insufficient_scope', scope });
}

export function grantCovers(connection: Doc<'agentConnections'>, spaceId: Id<'spaces'>) {
  return connection.spaceMode === 'all' || connection.spaceIds.includes(spaceId);
}

/** The space must be in the grant and the person must still be a member, right now. */
export async function requireAgentSpace(ctx: QueryCtx | MutationCtx, actor: AgentActor, spaceId: Id<'spaces'>) {
  const space = await ctx.db.get(spaceId);
  const membership = space && grantCovers(actor.connection, spaceId)
    ? await ctx.db.query('memberships').withIndex('by_space_user', q => q.eq('spaceId', spaceId).eq('userId', actor.user._id)).unique()
    : null;
  if (!space || !membership) throw new ConvexError('That space isn’t shared with this connection.');
  return { space, membership };
}

export function cleanScopes(scopes: string[]) {
  const unknown = scopes.find(s => !isScope(s));
  if (unknown) throw new ConvexError('Unknown permission.');
  return SCOPES.filter(s => scopes.includes(s));
}

/** Validates a person's choice of spaces for a grant: only spaces they belong to, deduplicated. */
export async function cleanGrantSpaces(ctx: QueryCtx | MutationCtx, userId: Id<'users'>, mode: 'all' | 'selected', spaceIds: Id<'spaces'>[]) {
  if (mode === 'all') return [];
  const unique = [...new Set(spaceIds)];
  if (unique.length > MAX_GRANT_SPACES) throw new ConvexError('Choose fewer spaces.');
  for (const spaceId of unique) {
    const membership = await ctx.db.query('memberships').withIndex('by_space_user', q => q.eq('spaceId', spaceId).eq('userId', userId)).unique();
    if (!membership) throw new ConvexError('You can only share spaces you belong to.');
  }
  return unique;
}

/** Agent names are chosen by the person; control characters are dropped and length is bounded. */
export function cleanAgentName(value: string) {
  const name = value.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 40) throw new ConvexError('Use between 1 and 40 characters for the agent’s name.');
  return name;
}

/**
 * Grants have a bounded lifecycle: revoking deletes the row (messages keep the agent's name), and
 * abandoned pending OAuth grants are swept here. So a person never has more than MAX_CONNECTIONS
 * rows, every one of them listed, and this count is exact. Expired grants still count until removed.
 */
export async function makeRoomForConnection(ctx: MutationCtx, userId: Id<'users'>) {
  const rows = await ctx.db.query('agentConnections').withIndex('by_user', q => q.eq('userId', userId)).collect();
  let count = 0;
  for (const row of rows) {
    if (row.pending && row._creationTime + REQUEST_TTL + CODE_TTL < Date.now()) await revokeConnection(ctx, row);
    else count++;
  }
  if (count >= MAX_CONNECTIONS) throw new ConvexError(`You can connect up to ${MAX_CONNECTIONS} agents. Disconnect one first.`);
}

/**
 * Revokes a grant in constant time: deleting the row is what invalidates every token (each check
 * loads the grant). Leftover token rows are swept in bounded batches afterwards.
 */
export async function revokeConnection(ctx: MutationCtx, connection: Doc<'agentConnections'>) {
  await ctx.db.delete(connection._id);
  await ctx.scheduler.runAfter(0, internal.agents.sweepTokens, { connectionId: connection._id });
}

// Secrets are generated in actions (non-deterministic runtime) and only their hashes reach the database.
export function randomSecret(prefix: string, bytes = 32) {
  return prefix + base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
export function base64url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
export async function hashSecret(value: string) {
  return base64url(await sha256(value));
}
export const TOKEN_PATTERN = /^cmn_(at|pat)_[A-Za-z0-9_-]{43}$/;

/** The canonical issuer and MCP resource. Always the deployment's own site URL, never a request's Host. */
export function issuer() {
  const url = process.env.CONVEX_SITE_URL;
  if (!url) throw new Error('CONVEX_SITE_URL is not set.');
  return url.replace(/\/+$/, '');
}
export const mcpResource = () => `${issuer()}/mcp`;
