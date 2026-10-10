import { SITE } from '../../src/site';

// Transactional email through Resend. Configured by AUTH_RESEND_KEY and AUTH_EMAIL
// (a sender on a domain verified in Resend, e.g. `Common <hello@example.com>`), plus an
// optional AUTH_REPLY_TO for where replies should land.

export const emailConfigured = () => Boolean(process.env.AUTH_RESEND_KEY && process.env.AUTH_EMAIL);

export async function sendEmail(message: { to: string; subject: string; text: string; html: string; idempotencyKey?: string }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
      'Content-Type': 'application/json',
      ...(message.idempotencyKey && { 'Idempotency-Key': message.idempotencyKey }),
    },
    body: JSON.stringify({
      from: process.env.AUTH_EMAIL,
      to: [message.to],
      // Optional: replies go here (any address) instead of the sending address.
      ...(process.env.AUTH_REPLY_TO?.trim() && { reply_to: process.env.AUTH_REPLY_TO.trim() }),
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });
  return response.ok;
}

// Names and space titles come from users: escape them for HTML, and keep subjects on one line.
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const line = (s: string) => s.replace(/\s+/g, ' ').trim();

const MARK = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true"><defs><clipPath id="a"><circle cx="12" cy="8.9" r="5.4"/></clipPath><clipPath id="b" clip-path="url(#a)"><circle cx="8.4" cy="15.1" r="5.4"/></clipPath></defs><circle cx="15.6" cy="15.1" r="5.4" fill="#1c1c1a" clip-path="url(#b)"/><g stroke="#1c1c1a" stroke-width="1.5"><circle cx="12" cy="8.9" r="5.4"/><circle cx="8.4" cy="15.1" r="5.4"/><circle cx="15.6" cy="15.1" r="5.4"/></g></svg>`;

function layout({ preheader, body, footer }: { preheader: string; body: string; footer: string }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;color:#1c1c1a">
<div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f2;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:20px;padding:32px 28px;box-shadow:0 0 0 1px rgba(28,28,26,0.06)">
<tr><td style="padding-bottom:22px">${MARK}</td></tr>
<tr><td>${body}</td></tr>
</table>
<p style="max-width:440px;margin:18px auto 0;font-size:12px;line-height:1.5;color:#8f8d86">${footer}</p>
</td></tr></table></body></html>`;
}

const button = (label: string, url: string) =>
  `<a href="${esc(url)}" style="display:inline-block;margin-top:22px;padding:13px 22px;border-radius:14px;background:#1c1c1a;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">${esc(label)}</a>`;

export function signInCodeEmail(code: string) {
  return {
    subject: `${code} is your Common sign-in code`,
    text: `Your Common sign-in code is ${code}.\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`,
    html: layout({
      preheader: `Your sign-in code is ${code}`,
      body: `<h1 style="margin:0;font-size:22px;line-height:1.25;letter-spacing:-0.02em">Your sign-in code</h1>
<p style="margin:10px 0 0;font-size:15px;line-height:1.5;color:#57554f">Enter this code in Common to finish signing in.</p>
<p style="margin:22px 0 0;padding:16px 0;border-radius:14px;background:#f5f5f2;text-align:center;font-size:30px;font-weight:700;letter-spacing:0.28em;font-variant-numeric:tabular-nums">${esc(code)}</p>`,
      footer: `This code expires in 10 minutes. If you didn't ask for it, you can safely ignore this email.`,
    }),
  };
}

export function invitationEmail({ spaceName, inviterName, siteUrl }: { spaceName: string; inviterName: string; siteUrl?: string }) {
  const space = line(spaceName);
  const inviter = line(inviterName);
  const how = siteUrl ? `Open Common and sign in with this email address to join:\n${siteUrl}` : 'Sign in to Common with this email address to join.';
  return {
    subject: `${inviter} invited you to ${space} on Common`,
    text: `${inviter} invited you to ${space} on Common.\n\n${how}\n\nThe invitation expires in 7 days.`,
    html: layout({
      preheader: `${inviter} invited you to ${space}`,
      body: `<h1 style="margin:0;font-size:22px;line-height:1.25;letter-spacing:-0.02em">${esc(inviter)} invited you to <span style="white-space:nowrap">${esc(space)}</span></h1>
<p style="margin:10px 0 0;font-size:15px;line-height:1.5;color:#57554f">${esc(SITE.tagline)} Sign in with this email address and the invitation will be waiting for you.</p>
${siteUrl ? button('Join on Common', siteUrl) : ''}`,
      footer: `This invitation expires in 7 days. If you weren't expecting it, you can ignore this email.`,
    }),
  };
}
