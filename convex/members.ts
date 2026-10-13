import { mutation, query, type MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { ConvexError, v } from 'convex/values';
import { hashColor, maskEmail, normalizeEmail, person, rateLimit, requireMember, requireOwner, requireUser, type Actor } from './lib/access';
import { emailConfigured } from './lib/email';
export const list = query({ args: { spaceId: v.id('spaces') }, handler: async (ctx, { spaceId }) => {
  await requireMember(ctx, spaceId);
  const members = await ctx.db.query('memberships').withIndex('by_space', q => q.eq('spaceId', spaceId)).collect();
  return Promise.all(members.map(async m => ({ ...await person(ctx, m.userId, true), role: m.role, color: m.color ?? hashColor(m.userId) })));
}});
export const invitations = query({ args: { spaceId: v.id('spaces') }, handler: async (ctx, { spaceId }) => {
  const { user, membership } = await requireMember(ctx, spaceId);
  const pending = await ctx.db.query('invitations').withIndex('by_space', q => q.eq('spaceId', spaceId)).collect();
  return pending.filter(i => i.expiresAt > Date.now()).map(i => {
    // Pending addresses are masked for everyone, the inviter included; revoking works by id.
    const canRevoke = membership.role === 'owner' || i.inviterId === user._id;
    return { id: i._id, email: maskEmail(i.email), createdAt: i._creationTime, canRevoke };
  });
}});
export const pending = query({ args: {}, handler: async ctx => {
  const user = await requireUser(ctx);
  const invites = await ctx.db.query('invitations').withIndex('by_email', q => q.eq('email', normalizeEmail(user.email!))).collect();
  const result = await Promise.all(invites.filter(i => i.expiresAt > Date.now()).map(async i => {
    const space = await ctx.db.get(i.spaceId);
    return space ? { id: i._id, spaceName: space.name, inviterName: (await person(ctx, i.inviterId)).name } : null;
  }));
  return result.filter(i => i !== null);
}});
export const invite = mutation({ args: { spaceId: v.id('spaces'), email: v.string() }, handler: async (ctx, { spaceId, email }) => {
  const { user } = await requireMember(ctx, spaceId);
  return inviteMember(ctx, { user }, spaceId, email);
}});
export async function inviteMember(ctx: MutationCtx, { user, agent }: Actor, spaceId: Id<'spaces'>, email: string) {
  const address = normalizeEmail(email);
  const space = await ctx.db.get(spaceId);
  if (!space || space.memberCount >= 100) throw new ConvexError('This space has reached its member limit.');
  const allMembers = await ctx.db.query('memberships').withIndex('by_space', q => q.eq('spaceId', spaceId)).collect();
  for (const member of allMembers) {
    const u = await ctx.db.get(member.userId);
    if (u?.email?.trim().toLowerCase() === address) throw new ConvexError('This person is already a member.');
  }
  const old = await ctx.db.query('invitations').withIndex('by_space_email', q => q.eq('spaceId', spaceId).eq('email', address)).unique();
  if (old && old.expiresAt > Date.now()) throw new ConvexError('An invitation is already waiting for this person.');
  const pending = await ctx.db.query('invitations').withIndex('by_space', q => q.eq('spaceId', spaceId)).collect();
  if (pending.filter(i => i.expiresAt > Date.now()).length >= 100) throw new ConvexError('This space has too many pending invitations.');
  await rateLimit(ctx, `invite:${user._id}`, 20, 3_600_000);
  if (old) await ctx.db.delete(old._id);
  const invitationId = await ctx.db.insert('invitations', { spaceId, email: address, inviterId: user._id, expiresAt: Date.now() + 7 * 86_400_000 });
  await ctx.db.insert('activities', { spaceId, actorId: user._id, kind: 'member_invited', subject: address, agentName: agent?.name });
  if (emailConfigured()) await ctx.scheduler.runAfter(0, internal.notifications.invitation, { invitationId, attempt: 0 });
  return invitationId;
}
export const accept = mutation({ args: { invitationId: v.id('invitations') }, handler: async (ctx, { invitationId }) => {
  const user = await requireUser(ctx);
  const invite = await ctx.db.get(invitationId);
  if (!invite || invite.expiresAt <= Date.now() || invite.email !== normalizeEmail(user.email!)) throw new ConvexError('This invitation is unavailable.');
  const space = await ctx.db.get(invite.spaceId);
  if (!space || space.memberCount >= 100) throw new ConvexError('This space is unavailable.');
  const existing = await ctx.db.query('memberships').withIndex('by_space_user', q => q.eq('spaceId', space._id).eq('userId', user._id)).unique();
  if (!existing) {
    const roster = await ctx.db.query('memberships').withIndex('by_space', q => q.eq('spaceId', space._id)).collect();
    const usedColors = new Set(roster.map(m => m.color ?? hashColor(m.userId)));
    const preferred = hashColor(user._id);
    const color = Array.from({ length: 8 }, (_, i) => (preferred + i) % 8).find(c => !usedColors.has(c)) ?? preferred;
    await ctx.db.insert('memberships', { spaceId: space._id, userId: user._id, role: 'member', color, lastReadSequence: 0 });
    await ctx.db.patch(space._id, { memberCount: space.memberCount + 1 });
    await ctx.db.insert('activities', { spaceId: space._id, actorId: user._id, kind: 'member_joined' });
  }
  await ctx.db.delete(invitationId);
  return space._id;
}});
export const revoke = mutation({ args: { invitationId: v.id('invitations') }, handler: async (ctx, { invitationId }) => {
  const invite = await ctx.db.get(invitationId);
  if (!invite) throw new ConvexError('Invitation not found.');
  const { user, membership } = await requireMember(ctx, invite.spaceId);
  await revokeInvitation(ctx, { user }, membership, invite);
}});
export async function revokeInvitation(ctx: MutationCtx, { user, agent }: Actor, membership: Doc<'memberships'>, invite: Doc<'invitations'>) {
  if (membership.role !== 'owner' && user._id !== invite.inviterId) throw new ConvexError('Only the inviter or space owner can revoke this invitation.');
  await ctx.db.delete(invite._id);
  await ctx.db.insert('activities', { spaceId: invite.spaceId, actorId: user._id, kind: 'invite_revoked', subject: invite.email, agentName: agent?.name });
}
export const remove = mutation({ args: { spaceId: v.id('spaces'), userId: v.id('users') }, handler: async (ctx, { spaceId, userId }) => {
  const { user, membership } = await requireOwner(ctx, spaceId);
  await removeMember(ctx, { user }, membership, userId);
}});
/** Owner only. The removed person's agents lose the space too, so re-inviting them never quietly restores agent access. */
export async function removeMember(ctx: MutationCtx, { user, agent }: Actor, membership: Doc<'memberships'>, userId: Id<'users'>) {
  const spaceId = membership.spaceId;
  if (membership.role !== 'owner') throw new ConvexError('Only the space owner can do this.');
  if (userId === user._id) throw new ConvexError('The owner cannot be removed.');
  const target = await ctx.db.query('memberships').withIndex('by_space_user', q => q.eq('spaceId', spaceId).eq('userId', userId)).unique();
  if (!target) return;
  const space = await ctx.db.get(spaceId);
  await ctx.db.delete(target._id);
  if (space) await ctx.db.patch(spaceId, { memberCount: Math.max(1, space.memberCount - 1) });
  for (const connection of await ctx.db.query('agentConnections').withIndex('by_user', q => q.eq('userId', userId)).collect()) {
    if (connection.spaceIds.includes(spaceId)) await ctx.db.patch(connection._id, { spaceIds: connection.spaceIds.filter(id => id !== spaceId) });
  }
  await ctx.db.insert('activities', { spaceId, actorId: user._id, kind: 'member_removed', subject: (await person(ctx, userId)).name, agentName: agent?.name });
}
export const activity = query({ args: { spaceId: v.id('spaces') }, handler: async (ctx, { spaceId }) => {
  await requireMember(ctx, spaceId);
  const events = await ctx.db.query('activities').withIndex('by_space', q => q.eq('spaceId', spaceId)).order('desc').take(50);
  // Invite events store the invitee's email. Everyone in the space reads this feed, so show the
  // person's name once they've joined, and otherwise a masked address, for everyone.
  const members = await ctx.db.query('memberships').withIndex('by_space', q => q.eq('spaceId', spaceId)).collect();
  const nameByEmail = new Map<string, string>();
  for (const m of members) {
    const who = await person(ctx, m.userId, true);
    if (who.email) nameByEmail.set(who.email.trim().toLowerCase(), who.name);
  }
  const subjectFor = (e: (typeof events)[number]) => {
    if (!e.subject || (e.kind !== 'member_invited' && e.kind !== 'invite_revoked')) return e.subject;
    const email = e.subject.trim().toLowerCase();
    return nameByEmail.get(email) ?? maskEmail(email);
  };
  return Promise.all(events.map(async e => ({ id: e._id, kind: e.kind, actorName: (await person(ctx, e.actorId)).name, agentName: e.agentName, subject: subjectFor(e), createdAt: e._creationTime })));
}});
