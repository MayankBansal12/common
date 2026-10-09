import { mutation, query } from './_generated/server';
import { paginationOptsValidator } from 'convex/server';
import { v, ConvexError } from 'convex/values';
import { person, rateLimit, requireMember } from './lib/access';
export const list = query({ args: { spaceId: v.id('spaces'), paginationOpts: paginationOptsValidator }, handler: async (ctx, { spaceId, paginationOpts }) => {
  await requireMember(ctx, spaceId);
  const result = await ctx.db.query('messages').withIndex('by_space', q => q.eq('spaceId', spaceId)).order('desc').paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 100) });
  const authors = new Map(await Promise.all([...new Set(result.page.map(m => m.senderId))].map(async id => [id, await person(ctx, id)] as const)));
  return { ...result, page: result.page.map(m => ({ id: m._id, clientId: m.clientId, body: m.body, createdAt: m._creationTime, sequence: m.sequence, sender: { ...authors.get(m.senderId)!, color: m.color ?? authors.get(m.senderId)!.color }, status: 'sent' as const })) };
}});
export const send = mutation({ args: { spaceId: v.id('spaces'), body: v.string(), clientId: v.string() }, handler: async (ctx, { spaceId, body, clientId }) => {
  const { user, membership } = await requireMember(ctx, spaceId);
  const text = body.trim();
  if (!text || text.length > 8000) throw new ConvexError('Messages must be between 1 and 8,000 characters.');
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
  return id;
}});
