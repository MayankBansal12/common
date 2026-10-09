import Google from '@auth/core/providers/google';
import { Email } from '@convex-dev/auth/providers/Email';
import { convexAuth } from '@convex-dev/auth/server';

const email = Email({
  id: 'resend-otp',
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 60 * 10,
  normalizeIdentifier: identifier => identifier.trim().toLowerCase(),
  async generateVerificationToken() {
    // Rejection sampling avoids modulo bias in the eight-digit code.
    let code = '';
    while (code.length < 8) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      for (const byte of bytes) if (byte < 250 && code.length < 8) code += byte % 10;
    }
    return code;
  },
  async sendVerificationRequest({ identifier, token }) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.AUTH_EMAIL, to: [identifier], subject: `${token} is your Common sign-in code`, text: `Your Common sign-in code is ${token}.\n\nIt expires in 10 minutes. If you did not request it, you can ignore this email.` }),
    });
    if (!response.ok) throw new Error('Unable to send your sign-in code. Please try again.');
  },
});
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET ? [Google({
      profile(profile) {
        return { id: profile.sub, name: profile.name, email: profile.email?.trim().toLowerCase(), emailVerified: profile.email_verified === true };
      },
    })] : []),
    ...(process.env.AUTH_RESEND_KEY && process.env.AUTH_EMAIL ? [email] : []),
  ],
});
