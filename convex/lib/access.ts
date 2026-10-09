import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const id = await getAuthUserId(ctx);
  const user = id ? await ctx.db.get(id) : null;
  if (!user || !user.email || !user.emailVerificationTime) throw new ConvexError('Please sign in again.');
  return user;
}
export async function requireMember(ctx: QueryCtx | MutationCtx, spaceId: Id<'spaces'>) {
  const user = await requireUser(ctx);
  const membership = await ctx.db.query('memberships').withIndex('by_space_user', q => q.eq('spaceId', spaceId).eq('userId', user._id)).unique();
  if (!membership) throw new ConvexError('You no longer have access to this space.');
  return { user, membership };
}
export async function requireOwner(ctx: QueryCtx | MutationCtx, spaceId: Id<'spaces'>) {
  const result = await requireMember(ctx, spaceId);
  if (result.membership.role !== 'owner') throw new ConvexError('Only the space owner can do this.');
  return result;
}
export function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new ConvexError('Enter a valid email address.');
  return normalized;
}
export function cleanName(value: string, max = 60) {
  const name = value.trim();
  if (!name || name.length > max) throw new ConvexError(`Use between 1 and ${max} characters.`);
  return name;
}
export async function rateLimit(ctx: MutationCtx, key: string, max: number, windowMs: number) {
  const current = await ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', key)).unique();
  const now = Date.now();
  if (!current) { await ctx.db.insert('rateLimits', { key, start: now, count: 1 }); return; }
  if (now - current.start >= windowMs) { await ctx.db.patch(current._id, { start: now, count: 1 }); return; }
  if (current.count >= max) throw new ConvexError('A little too fast. Please try again shortly.');
  await ctx.db.patch(current._id, { count: current.count + 1 });
}
export async function person(ctx: QueryCtx | MutationCtx, userId: Id<'users'>, includeEmail = false) {
  const user = await ctx.db.get(userId);
  const profile = await ctx.db.query('profiles').withIndex('by_user', q => q.eq('userId', userId)).unique();
  return { id: userId, name: profile?.name || user?.name || user?.email?.split('@')[0] || 'Member', email: includeEmail ? user?.email ?? '' : '', avatarSeed: profile?.avatarSeed ?? userId, color: profile?.color ?? hashColor(userId) };
}
export function hashColor(seed: string) { return Array.from(seed).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0) % 8; }
