import Google from '@auth/core/providers/google';
import { Email } from '@convex-dev/auth/providers/Email';
import { convexAuth } from '@convex-dev/auth/server';
import { emailConfigured, sendEmail, signInCodeEmail } from './lib/email';

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
    if (!(await sendEmail({ to: identifier, ...signInCodeEmail(token) }))) throw new Error('Unable to send your sign-in code. Please try again.');
  },
});
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET ? [Google({
      profile(profile) {
        return { id: profile.sub, name: profile.name, email: profile.email?.trim().toLowerCase(), emailVerified: profile.email_verified === true };
      },
    })] : []),
    ...(emailConfigured() ? [email] : []),
  ],
});
