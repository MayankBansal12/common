import { internalAction, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
export const invitationDetails = internalQuery({ args: { invitationId: v.id('invitations') }, handler: async (ctx, { invitationId }) => {
  const invitation = await ctx.db.get(invitationId);
  if (!invitation || invitation.expiresAt <= Date.now()) return null;
  const space = await ctx.db.get(invitation.spaceId);
  return space ? { email: invitation.email, spaceName: space.name } : null;
}});
export const invitation = internalAction({ args: { invitationId: v.id('invitations'), attempt: v.number() }, handler: async (ctx, { invitationId, attempt }) => {
  const data = await ctx.runQuery(internal.notifications.invitationDetails, { invitationId });
  if (!data) return;
  try {
    const result = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `invitation-${invitationId}` },
      body: JSON.stringify({ from: process.env.AUTH_EMAIL, to: [data.email], subject: `Join ${data.spaceName} on Common`, text: `You've been invited to ${data.spaceName}.\n\nSign in with this email to accept your invitation:\n${process.env.SITE_URL}\n\nYour invitation expires in 7 days.` }),
    });
    if (!result.ok) throw new Error('Email delivery failed.');
  } catch {
    if (attempt < 4) await ctx.scheduler.runAfter(30_000 * 2 ** attempt, internal.notifications.invitation, { invitationId, attempt: attempt + 1 });
    else throw new Error('Invitation email delivery failed after retries. Invitation remains available in the app.');
  }
}});
