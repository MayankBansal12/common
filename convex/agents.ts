import { action, internalMutation, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { requireUser } from './lib/access';
import {
  CODE_TTL, cleanAgentName, cleanGrantSpaces, cleanScopes, hashSecret, issuer, makeRoomForConnection, randomSecret, revokeConnection, type Scope,
} from './lib/agents';

/** Agent connections, managed by the person who granted them. No secrets or hashes ever leave the server. */
const grantArgs = {
  name: v.string(),
  scopes: v.array(v.string()),
  spaceMode: v.union(v.literal('all'), v.literal('selected')),
  spaceIds: v.array(v.id('spaces')),
};

export const list = query({ args: {}, handler: async ctx => {
  const user = await requireUser(ctx);
  // Bounded by MAX_CONNECTIONS: revoked grants are deleted, abandoned pending ones are swept.
  const rows = await ctx.db.query('agentConnections').withIndex('by_user', q => q.eq('userId', user._id)).collect();
  const now = Date.now();
  return Promise.all(rows.filter(c => !c.pending).sort((a, b) => b._creationTime - a._creationTime).map(async c => ({
    id: c._id,
    name: c.name,
    kind: c.kind,
    clientName: c.clientName,
    redirectHost: c.redirectHost,
    scopes: c.scopes as Scope[],
    requestedScopes: (c.requestedScopes ?? null) as Scope[] | null,
    spaceMode: c.spaceMode,
    spaces: (await Promise.all(c.spaceIds.map(async id => {
      const space = await ctx.db.get(id);
      return space ? { id: space._id as string, name: space.name } : null;
    }))).filter(s => s !== null),
    createdAt: c._creationTime,
    lastUsedAt: c.lastUsedAt,
    expiresAt: c.expiresAt,
    expired: c.expiresAt !== undefined && c.expiresAt <= now,
  })));
}});

export const update = mutation({ args: { connectionId: v.id('agentConnections'), ...grantArgs }, handler: async (ctx, args) => {
  const user = await requireUser(ctx);
  const connection = await ctx.db.get(args.connectionId);
  if (!connection || connection.userId !== user._id || connection.pending) throw new ConvexError('This connection no longer exists.');
  const scopes = cleanScopes(args.scopes);
  if (connection.requestedScopes && scopes.some(s => !connection.requestedScopes!.includes(s))) throw new ConvexError('This agent didn’t ask for that permission. Reconnect it to grant more.');
  await ctx.db.patch(connection._id, { name: cleanAgentName(args.name), scopes, spaceMode: args.spaceMode, spaceIds: await cleanGrantSpaces(ctx, user._id, args.spaceMode, args.spaceIds) });
}});

export const revoke = mutation({ args: { connectionId: v.id('agentConnections') }, handler: async (ctx, { connectionId }) => {
  const user = await requireUser(ctx);
  const connection = await ctx.db.get(connectionId);
  if (connection && connection.userId === user._id) await revokeConnection(ctx, connection);
}});

/** Deletes a revoked grant's leftover token rows, a batch at a time. */
export const sweepTokens = internalMutation({ args: { connectionId: v.id('agentConnections') }, handler: async (ctx, { connectionId }) => {
  const batch = await ctx.db.query('agentTokens').withIndex('by_connection', q => q.eq('connectionId', connectionId)).take(100);
  for (const token of batch) await ctx.db.delete(token._id);
  if (batch.length === 100) await ctx.scheduler.runAfter(0, internal.agents.sweepTokens, { connectionId });
}});

// Personal access tokens, for MCP clients that can't sign in through the browser.
export const createToken = action({ args: { ...grantArgs, expiresInDays: v.optional(v.union(v.literal(30), v.literal(90))) }, handler: async (ctx, args): Promise<{ token: string; connectionId: Id<'agentConnections'> }> => {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError('Please sign in again.');
  const token = randomSecret('cmn_pat_');
  const connectionId = await ctx.runMutation(internal.agents.storeToken, { userId, hash: await hashSecret(token), ...args });
  return { token, connectionId };
}});
export const storeToken = internalMutation({ args: { userId: v.id('users'), hash: v.string(), ...grantArgs, expiresInDays: v.optional(v.union(v.literal(30), v.literal(90))) }, handler: async (ctx, args) => {
  const user = await ctx.db.get(args.userId);
  if (!user?.email || !user.emailVerificationTime) throw new ConvexError('Please sign in again.');
  await makeRoomForConnection(ctx, user._id);
  const scopes = cleanScopes(args.scopes);
  const expiresAt = args.expiresInDays ? Date.now() + args.expiresInDays * 86_400_000 : undefined;
  const connectionId = await ctx.db.insert('agentConnections', {
    userId: user._id, name: cleanAgentName(args.name), kind: 'token', scopes, spaceMode: args.spaceMode,
    spaceIds: await cleanGrantSpaces(ctx, user._id, args.spaceMode, args.spaceIds), expiresAt,
  });
  await ctx.db.insert('agentTokens', { connectionId, hash: args.hash, kind: 'personal', expiresAt });
  return connectionId;
}});

// Browser consent for OAuth clients. The request ID only identifies a pending request; it grants nothing.
export const consentRequest = query({ args: { requestId: v.string() }, handler: async (ctx, { requestId }) => {
  const request = await ctx.db.query('oauthRequests').withIndex('by_request', q => q.eq('requestId', requestId)).unique();
  if (!request || request.expiresAt <= Date.now()) return { status: 'expired' as const };
  const client = await ctx.db.query('oauthClients').withIndex('by_client', q => q.eq('clientId', request.clientId)).unique();
  if (!client) return { status: 'expired' as const };
  return { status: 'ready' as const, clientName: client.name, redirectHost: new URL(request.redirectUri).host, requestedScopes: request.scopes as Scope[] };
}});

export const approve = action({ args: { requestId: v.string(), ...grantArgs }, handler: async (ctx, args): Promise<{ redirectUrl: string }> => {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError('Please sign in again.');
  const code = randomSecret('cmn_code_');
  const result = await ctx.runMutation(internal.agents.storeApproval, { userId, codeHash: await hashSecret(code), ...args });
  return { redirectUrl: callback(result.redirectUri, { code, state: result.state }) };
}});
export const storeApproval = internalMutation({ args: { userId: v.id('users'), codeHash: v.string(), requestId: v.string(), ...grantArgs }, handler: async (ctx, args) => {
  const user = await ctx.db.get(args.userId);
  if (!user?.email || !user.emailVerificationTime) throw new ConvexError('Please sign in again.');
  const request = await ctx.db.query('oauthRequests').withIndex('by_request', q => q.eq('requestId', args.requestId)).unique();
  if (!request || request.expiresAt <= Date.now()) throw new ConvexError('This request has expired. Start connecting again from your agent.');
  const client = await ctx.db.query('oauthClients').withIndex('by_client', q => q.eq('clientId', request.clientId)).unique();
  if (!client) throw new ConvexError('This request has expired. Start connecting again from your agent.');
  const scopes = cleanScopes(args.scopes);
  if (scopes.some(s => !request.scopes.includes(s))) throw new ConvexError('This agent didn’t ask for that permission.');
  await makeRoomForConnection(ctx, user._id);
  const connectionId = await ctx.db.insert('agentConnections', {
    userId: user._id, name: cleanAgentName(args.name), kind: 'oauth', clientId: client.clientId, clientName: client.name,
    redirectHost: new URL(request.redirectUri).host, scopes, requestedScopes: request.scopes, spaceMode: args.spaceMode,
    spaceIds: await cleanGrantSpaces(ctx, user._id, args.spaceMode, args.spaceIds), pending: true,
  });
  await ctx.db.insert('oauthCodes', { hash: args.codeHash, connectionId, clientId: client.clientId, redirectUri: request.redirectUri, codeChallenge: request.codeChallenge, resource: request.resource, expiresAt: Date.now() + CODE_TTL });
  await ctx.db.delete(request._id);
  return { redirectUri: request.redirectUri, state: request.state };
}});

/** Declining sends the person back to the agent with `access_denied`. Nothing is created. */
export const deny = mutation({ args: { requestId: v.string() }, handler: async (ctx, { requestId }) => {
  const request = await ctx.db.query('oauthRequests').withIndex('by_request', q => q.eq('requestId', requestId)).unique();
  if (!request || request.expiresAt <= Date.now()) return { redirectUrl: null };
  await ctx.db.delete(request._id);
  return { redirectUrl: callback(request.redirectUri, { error: 'access_denied', error_description: 'The person declined to connect.', state: request.state }) };
}});

/** The authorization response, with `iss` (RFC 9207) so clients can detect mix-up attacks. */
export function callback(redirectUri: string, params: Record<string, string | undefined>) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries({ ...params, iss: issuer() })) if (value !== undefined) url.searchParams.set(key, value);
  return url.toString();
}
