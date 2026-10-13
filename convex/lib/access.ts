import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
/** Who performs a change: a person, or an agent acting for that person (attributed to both). */
export type Actor = { user: Doc<'users'>; agent?: { id: Id<'agentConnections'>; name: string } };
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
  if (await takeRateLimit(ctx, key, max, windowMs)) throw new ConvexError('A little too fast. Please try again shortly.');
}
/** Counts one hit against `key`. Returns 0 when allowed, otherwise milliseconds until the window resets (nothing is written). */
export async function takeRateLimit(ctx: MutationCtx, key: string, max: number, windowMs: number) {
  const current = await ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', key)).unique();
  const now = Date.now();
  if (!current) { await ctx.db.insert('rateLimits', { key, start: now, count: 1 }); return 0; }
  if (now - current.start >= windowMs) { await ctx.db.patch(current._id, { start: now, count: 1 }); return 0; }
  if (current.count >= max) return Math.max(1, current.start + windowMs - now);
  await ctx.db.patch(current._id, { count: current.count + 1 });
  return 0;
}
export async function person(ctx: QueryCtx | MutationCtx, userId: Id<'users'>, includeEmail = false) {
  const user = await ctx.db.get(userId);
  const profile = await ctx.db.query('profiles').withIndex('by_user', q => q.eq('userId', userId)).unique();
  return { id: userId, name: profile?.name || user?.name || user?.email?.split('@')[0] || 'Member', email: includeEmail ? user?.email ?? '' : '', avatarSeed: profile?.avatarSeed ?? userId, color: profile?.color ?? hashColor(userId), imageUrl: await imageUrl(ctx, profile?.imageId) };
}
export async function imageUrl(ctx: QueryCtx | MutationCtx, id: Id<'_storage'> | undefined) {
  return id ? (await ctx.storage.getUrl(id)) ?? undefined : undefined;
}
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** An uploaded file may become a profile or space photo only if it is a reasonably sized image. */
export async function checkImage(ctx: MutationCtx, id: Id<'_storage'>) {
  const file = await ctx.db.system.get(id);
  if (!file || !file.contentType?.startsWith('image/') || file.size > MAX_IMAGE_BYTES) throw new ConvexError('Choose an image under 5 MB.');
  return id;
}
/** `undefined` keeps the current photo, `null` removes it. */
export async function nextImage(ctx: MutationCtx, next: Id<'_storage'> | null | undefined, current: Id<'_storage'> | undefined) {
  if (next === undefined) return current;
  return next === null ? undefined : checkImage(ctx, next);
}
/** `anomayank@gmail.com` → `an•••@gmail.com`: recognisable to people who know it, useless to anyone else. */
export function maskEmail(email: string) {
  const at = email.lastIndexOf('@');
  if (at < 1) return '•••';
  const local = email.slice(0, at);
  return `${local.slice(0, local.length > 2 ? 2 : 1)}•••${email.slice(at)}`;
}
export function hashColor(seed: string) { return Array.from(seed).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0) % 8; }
