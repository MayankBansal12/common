import Google from '@auth/core/providers/google';
import { Email } from '@convex-dev/auth/providers/Email';
import { convexAuth } from '@convex-dev/auth/server';
import { emailConfigured, sendEmail, signInCodeEmail } from './lib/email';

const CODE_DIGITS = 6;
const email = Email({
  id: 'resend-otp',
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 60 * 10,
  normalizeIdentifier: identifier => identifier.trim().toLowerCase(),
  async generateVerificationToken() {
    // Rejection sampling avoids modulo bias in the six-digit code. Codes expire after ten minutes,
    // and Convex Auth limits failed attempts, which keeps six digits safe to guess against.
    let code = '';
    while (code.length < CODE_DIGITS) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      for (const byte of bytes) if (byte < 250 && code.length < CODE_DIGITS) code += byte % 10;
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
