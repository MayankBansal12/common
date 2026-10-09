// Temporary development-only internal fixtures; removed after live browser verification.
import { internalMutation } from '../../convex/_generated/server';
import { v } from 'convex/values';
export const seed = internalMutation({ args: {}, handler: async ctx => {
  const run = crypto.randomUUID();
  const result = [];
  for (const name of ['QA Owner', 'QA Guest']) {
    const email = `${name === 'QA Owner' ? 'owner' : 'guest'}-${run}@common.invalid`;
    const userId = await ctx.db.insert('users', { name, email, emailVerificationTime: Date.now() });
    const sessionId = await ctx.db.insert('authSessions', { userId, expirationTime: Date.now() + 3_600_000 });
    const refreshId = await ctx.db.insert('authRefreshTokens', { sessionId, expirationTime: Date.now() + 3_600_000 });
    result.push({ userId, sessionId, refreshId, email, name });
  }
  return result;
}});
export const cleanup = internalMutation({ args: { userIds: v.array(v.id('users')) }, handler: async (ctx, { userIds }) => {
  for (const userId of userIds) {
    const user = await ctx.db.get(userId);
    if (!user?.email?.endsWith('@common.invalid')) throw new Error('Not a QA identity.');
    const memberships = await ctx.db.query('memberships').withIndex('by_user', q => q.eq('userId', userId)).collect();
    for (const membership of memberships) {
      const space = await ctx.db.get(membership.spaceId);
      if (space?.ownerId === userId) {
        for (const table of ['messages', 'memberships', 'invitations', 'activities'] as const) {
          const rows = await ctx.db.query(table).withIndex('by_space', q => q.eq('spaceId', space._id)).collect();
          for (const row of rows) await ctx.db.delete(row._id);
        }
        await ctx.db.delete(space._id);
      } else if (await ctx.db.get(membership._id)) await ctx.db.delete(membership._id);
    }
    for (const session of await ctx.db.query('authSessions').withIndex('userId', q => q.eq('userId', userId)).collect()) {
      for (const token of await ctx.db.query('authRefreshTokens').withIndex('sessionIdAndParentRefreshTokenId', q => q.eq('sessionId', session._id)).collect()) await ctx.db.delete(token._id);
      await ctx.db.delete(session._id);
    }
    for (const profile of await ctx.db.query('profiles').withIndex('by_user', q => q.eq('userId', userId)).collect()) await ctx.db.delete(profile._id);
    for (const key of [`create:${userId}`, `invite:${userId}`, `message:${userId}`]) {
      const r = await ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', key)).unique();
      if (r) await ctx.db.delete(r._id);
    }
    await ctx.db.delete(userId);
  }
}});
