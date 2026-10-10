import { mutation, query, type MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { paginationOptsValidator } from 'convex/server';
import { v, ConvexError } from 'convex/values';
import { person, rateLimit, requireMember } from './lib/access';
// Short by design: long enough for a real message or an agent prompt, short enough to stay conversational.
export const MESSAGE_LIMIT = 2000;
export const list = query({ args: { spaceId: v.id('spaces'), paginationOpts: paginationOptsValidator }, handler: async (ctx, { spaceId, paginationOpts }) => {
  await requireMember(ctx, spaceId);
  const result = await ctx.db.query('messages').withIndex('by_space', q => q.eq('spaceId', spaceId)).order('desc').paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 100) });
  const authors = new Map(await Promise.all([...new Set(result.page.map(m => m.senderId))].map(async id => [id, await person(ctx, id)] as const)));
  return { ...result, page: result.page.map(m => ({ id: m._id, clientId: m.clientId, body: m.body, createdAt: m._creationTime, sequence: m.sequence, sender: { ...authors.get(m.senderId)!, color: m.color ?? authors.get(m.senderId)!.color }, status: 'sent' as const })) };
}});
export const send = mutation({ args: { spaceId: v.id('spaces'), body: v.string(), clientId: v.string() }, handler: async (ctx, { spaceId, body, clientId }) => {
  const { user, membership } = await requireMember(ctx, spaceId);
  const text = body.trim();
  if (!text || text.length > MESSAGE_LIMIT) throw new ConvexError('Messages must be between 1 and 2,000 characters.');
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(clientId)) throw new ConvexError('Invalid message identifier.');
  const existing = await ctx.db.query('messages').withIndex('by_sender_client', q => q.eq('senderId', user._id).eq('clientId', clientId)).unique();
  if (existing) {
    if (existing.spaceId !== spaceId || existing.body !== text) throw new ConvexError('Message identifier already used.');
    return existing._id;
  }
  await rateLimit(ctx, `message:${user._id}`, 30, 10_000);
  const space = await ctx.db.get(spaceId);
  if (!space) throw new ConvexError('Space not found.');
  const sequence = space.messageCount + 1;
  const id = await ctx.db.insert('messages', { spaceId, senderId: user._id, actorKind: 'human', color: membership.color, body: text, clientId, sequence });
  await ctx.db.patch(spaceId, { messageCount: sequence, lastMessage: text.slice(0, 120), updatedAt: Date.now() });
  await ctx.db.patch(membership._id, { lastReadSequence: sequence });
  await clearTyping(ctx, spaceId, user._id);
  return id;
}});

// Typing: clients send `typing: true` every few seconds while composing and `false` when they stop.
// A row counts for TYPING_TTL after its last refresh, so a closed tab simply times out.
export const TYPING_TTL = 6_000;
async function clearTyping(ctx: MutationCtx, spaceId: Id<'spaces'>, userId: Id<'users'>) {
  const row = await ctx.db.query('typing').withIndex('by_space_user', q => q.eq('spaceId', spaceId).eq('userId', userId)).unique();
  if (row) await ctx.db.delete(row._id);
}
export const setTyping = mutation({ args: { spaceId: v.id('spaces'), typing: v.boolean() }, handler: async (ctx, { spaceId, typing }) => {
  const { user } = await requireMember(ctx, spaceId);
  if (!typing) return clearTyping(ctx, spaceId, user._id);
  const row = await ctx.db.query('typing').withIndex('by_space_user', q => q.eq('spaceId', spaceId).eq('userId', user._id)).unique();
  const now = Date.now();
  // Refreshed moments ago: nothing to do, which also caps how often a client can write here.
  if (row && row.expiresAt - TYPING_TTL > now - 1_500) return;
  if (row) await ctx.db.patch(row._id, { expiresAt: now + TYPING_TTL });
  else await ctx.db.insert('typing', { spaceId, userId: user._id, expiresAt: now + TYPING_TTL });
}});
/** Other members currently marked as typing. Expiry is checked by the client, so this query stays cacheable. */
export const typing = query({ args: { spaceId: v.id('spaces') }, handler: async (ctx, { spaceId }) => {
  const { user } = await requireMember(ctx, spaceId);
  const rows = await ctx.db.query('typing').withIndex('by_space', q => q.eq('spaceId', spaceId)).collect();
  const others = rows.filter(r => r.userId !== user._id);
  return Promise.all(others.map(async r => {
    const who = await person(ctx, r.userId);
    const membership = await ctx.db.query('memberships').withIndex('by_space_user', q => q.eq('spaceId', spaceId).eq('userId', r.userId)).unique();
    return membership ? { ...who, color: membership.color ?? who.color, expiresAt: r.expiresAt } : null;
  })).then(list => list.filter(t => t !== null));
}});
