import { mutation, query } from './_generated/server';
import { v, ConvexError } from 'convex/values';
import { cleanName, hashColor, rateLimit, requireMember, requireUser } from './lib/access';
export const list = query({ args: {}, handler: async ctx => {
  const user = await requireUser(ctx);
  const memberships = await ctx.db.query('memberships').withIndex('by_user', q => q.eq('userId', user._id)).collect();
  const spaces = await Promise.all(memberships.map(async membership => {
    const space = await ctx.db.get(membership.spaceId);
    if (!space) return null;
    return { id: space._id, name: space.name, symbol: space.symbol, color: space.color, memberCount: space.memberCount, unread: Math.max(0, space.messageCount - membership.lastReadSequence), lastMessage: space.lastMessage, updatedAt: space.updatedAt };
  }));
  return spaces.filter(s => s !== null).sort((a, b) => b.updatedAt - a.updatedAt);
}});
export const create = mutation({ args: { name: v.string(), symbol: v.string(), color: v.number() }, handler: async (ctx, args) => {
  const user = await requireUser(ctx);
  if (args.symbol.length > 16 || !args.symbol.trim() || !Number.isInteger(args.color) || args.color < 0 || args.color > 7) throw new ConvexError('Choose a space icon and color.');
  await rateLimit(ctx, `create:${user._id}`, 10, 3_600_000);
  const spaceId = await ctx.db.insert('spaces', { name: cleanName(args.name), symbol: args.symbol.trim(), color: args.color, ownerId: user._id, memberCount: 1, messageCount: 0, updatedAt: Date.now() });
  await ctx.db.insert('memberships', { spaceId, userId: user._id, role: 'owner', color: hashColor(user._id), lastReadSequence: 0 });
  await ctx.db.insert('activities', { spaceId, actorId: user._id, kind: 'space_created' });
  return spaceId;
}});
export const markRead = mutation({ args: { spaceId: v.id('spaces'), sequence: v.number() }, handler: async (ctx, { spaceId, sequence }) => {
  const { membership } = await requireMember(ctx, spaceId);
  const space = await ctx.db.get(spaceId);
  if (space) await ctx.db.patch(membership._id, { lastReadSequence: Math.max(membership.lastReadSequence, Math.min(space.messageCount, sequence)) });
}});
