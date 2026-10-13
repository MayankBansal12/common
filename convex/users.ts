import { query, mutation, type MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { cleanName, hashColor, nextImage, person, rateLimit, requireUser } from './lib/access';
export const me = query({ args: {}, handler: async ctx => {
  const id = await getAuthUserId(ctx);
  return id ? person(ctx, id, true) : null;
}});
export const authOptions = query({ args: {}, handler: async () => ({ google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET), email: Boolean(process.env.AUTH_RESEND_KEY && process.env.AUTH_EMAIL) }) });
const imageArg = v.optional(v.union(v.id('_storage'), v.null()));
export const update = mutation({ args: { name: v.string(), imageId: imageArg, avatarSeed: v.optional(v.string()) }, handler: async (ctx, args) => {
  const user = await requireUser(ctx);
  await updateProfile(ctx, user, args);
}});
export async function updateProfile(ctx: MutationCtx, user: Doc<'users'>, args: { name: string; imageId?: Id<'_storage'> | null; avatarSeed?: string }) {
  const current = await ctx.db.query('profiles').withIndex('by_user', q => q.eq('userId', user._id)).unique();
  const name = cleanName(args.name, 40);
  const imageId = await nextImage(ctx, args.imageId, current?.imageId);
  if (args.avatarSeed !== undefined && (!args.avatarSeed.trim() || args.avatarSeed.length > 64)) throw new ConvexError('Choose an avatar.');
  const avatarSeed = args.avatarSeed ?? current?.avatarSeed ?? user._id;
  if (current) await ctx.db.patch(current._id, { name, imageId, avatarSeed });
  else await ctx.db.insert('profiles', { userId: user._id, name, avatarSeed, color: hashColor(user._id), imageId });
}
export const generateUploadUrl = mutation({ args: {}, handler: async ctx => {
  const user = await requireUser(ctx);
  await rateLimit(ctx, `upload:${user._id}`, 30, 3_600_000);
  return ctx.storage.generateUploadUrl();
}});
