import { internalAction, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { person } from './lib/access';
import { invitationEmail, sendEmail } from './lib/email';
export const invitationDetails = internalQuery({ args: { invitationId: v.id('invitations') }, handler: async (ctx, { invitationId }) => {
  const invitation = await ctx.db.get(invitationId);
  if (!invitation || invitation.expiresAt <= Date.now()) return null;
  const space = await ctx.db.get(invitation.spaceId);
  return space ? { email: invitation.email, spaceName: space.name, inviterName: (await person(ctx, invitation.inviterId)).name } : null;
}});
export const invitation = internalAction({ args: { invitationId: v.id('invitations'), attempt: v.number() }, handler: async (ctx, { invitationId, attempt }) => {
  const data = await ctx.runQuery(internal.notifications.invitationDetails, { invitationId });
  if (!data) return;
  let sent = false;
  try {
    sent = await sendEmail({ to: data.email, idempotencyKey: `invitation-${invitationId}`, ...invitationEmail({ spaceName: data.spaceName, inviterName: data.inviterName, siteUrl: process.env.SITE_URL }) });
  } catch {
    sent = false;
  }
  if (sent) return;
  if (attempt < 4) await ctx.scheduler.runAfter(30_000 * 2 ** attempt, internal.notifications.invitation, { invitationId, attempt: attempt + 1 });
  else throw new Error('Invitation email delivery failed after retries. Invitation remains available in the app.');
}});
