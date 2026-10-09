import { query, mutation } from './_generated/server';
import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { cleanName, hashColor, person, requireUser } from './lib/access';
export const me = query({ args: {}, handler: async ctx => {
  const id = await getAuthUserId(ctx);
  return id ? person(ctx, id, true) : null;
}});
export const authOptions = query({ args: {}, handler: async () => ({ google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET), email: Boolean(process.env.AUTH_RESEND_KEY && process.env.AUTH_EMAIL) }) });
export const update = mutation({ args: { name: v.string() }, handler: async (ctx, { name }) => {
  const user = await requireUser(ctx);
  const current = await ctx.db.query('profiles').withIndex('by_user', q => q.eq('userId', user._id)).unique();
  if (current) await ctx.db.patch(current._id, { name: cleanName(name, 40) });
  else await ctx.db.insert('profiles', { userId: user._id, name: cleanName(name, 40), avatarSeed: user._id, color: hashColor(user._id) });
}});
