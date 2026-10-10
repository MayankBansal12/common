import { mutation, query } from './_generated/server';
import { v, ConvexError } from 'convex/values';
import { cleanName, hashColor, imageUrl, nextImage, rateLimit, requireMember, requireUser } from './lib/access';
export const list = query({ args: {}, handler: async ctx => {
  const user = await requireUser(ctx);
  const memberships = await ctx.db.query('memberships').withIndex('by_user', q => q.eq('userId', user._id)).collect();
  const spaces = await Promise.all(memberships.map(async membership => {
    const space = await ctx.db.get(membership.spaceId);
    if (!space) return null;
    return { id: space._id, name: space.name, symbol: space.symbol, color: space.color, imageUrl: await imageUrl(ctx, space.imageId), memberCount: space.memberCount, unread: Math.max(0, space.messageCount - membership.lastReadSequence), lastMessage: space.lastMessage, updatedAt: space.updatedAt };
  }));
  return spaces.filter(s => s !== null).sort((a, b) => b.updatedAt - a.updatedAt);
}});
const imageArg = v.optional(v.union(v.id('_storage'), v.null()));
function checkLook(symbol: string, color: number) {
  if (symbol.length > 16 || !symbol.trim() || !Number.isInteger(color) || color < 0 || color > 7) throw new ConvexError('Choose a space icon and color.');
}
export const create = mutation({ args: { name: v.string(), symbol: v.string(), color: v.number(), imageId: imageArg }, handler: async (ctx, args) => {
  const user = await requireUser(ctx);
  checkLook(args.symbol, args.color);
  await rateLimit(ctx, `create:${user._id}`, 10, 3_600_000);
  const imageId = await nextImage(ctx, args.imageId, undefined);
  const spaceId = await ctx.db.insert('spaces', { name: cleanName(args.name), symbol: args.symbol.trim(), color: args.color, imageId, ownerId: user._id, memberCount: 1, messageCount: 0, updatedAt: Date.now() });
  await ctx.db.insert('memberships', { spaceId, userId: user._id, role: 'owner', color: hashColor(user._id), lastReadSequence: 0 });
  await ctx.db.insert('activities', { spaceId, actorId: user._id, kind: 'space_created' });
  return spaceId;
}});
/** Any member can rename or restyle a space, like a group chat; the change is recorded in activity. */
export const update = mutation({ args: { spaceId: v.id('spaces'), name: v.string(), symbol: v.string(), color: v.number(), imageId: imageArg }, handler: async (ctx, args) => {
  const { user } = await requireMember(ctx, args.spaceId);
  const space = await ctx.db.get(args.spaceId);
  if (!space) throw new ConvexError('You no longer have access to this space.');
  checkLook(args.symbol, args.color);
  await rateLimit(ctx, `space-update:${user._id}`, 30, 3_600_000);
  const name = cleanName(args.name);
  await ctx.db.patch(space._id, { name, symbol: args.symbol.trim(), color: args.color, imageId: await nextImage(ctx, args.imageId, space.imageId) });
  await ctx.db.insert('activities', { spaceId: space._id, actorId: user._id, kind: 'space_updated', subject: name !== space.name ? name : undefined });
}});
export const markRead = mutation({ args: { spaceId: v.id('spaces'), sequence: v.number() }, handler: async (ctx, { spaceId, sequence }) => {
  const { membership } = await requireMember(ctx, spaceId);
  const space = await ctx.db.get(spaceId);
  if (space) await ctx.db.patch(membership._id, { lastReadSequence: Math.max(membership.lastReadSequence, Math.min(space.messageCount, sequence)) });
}});
