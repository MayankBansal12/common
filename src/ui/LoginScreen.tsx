import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import type { CommonUIProps } from '../types';
import { BrandMark, InlineError, Spinner } from './primitives';
import { errorText, isEmail } from './format';

type Props = Pick<
  CommonUIProps,
  'error' | 'emailStep' | 'emailAddress' | 'authBusy' | 'authAvailable' | 'onGoogleSignIn' | 'onEmailSignIn' | 'onVerifyCode' | 'onBackToEmail' | 'onDismissError'
>;

const CODE_LENGTH = 8;

function GoogleG() {
  return (
    <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function LoginScreen(p: Props) {
  const [email, setEmail] = useState(p.emailAddress);
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [pending, setPending] = useState<'google' | 'email' | 'code' | 'resend' | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalError(null);
    if (p.emailStep === 'code') {
      setCode('');
      codeRef.current?.focus();
    }
  }, [p.emailStep]);

  useEffect(() => {
    if (p.emailAddress) setEmail(p.emailAddress);
  }, [p.emailAddress]);

  const busy = p.authBusy || pending !== null;
  const shownError = localError ?? p.error;
  const nothingAvailable = !p.authAvailable.google && !p.authAvailable.email;

  async function attempt(kind: NonNullable<typeof pending>, fn: () => Promise<void>) {
    setPending(kind);
    setLocalError(null);
    if (p.error) p.onDismissError();
    try {
      await fn();
    } catch (e) {
      setLocalError(errorText(e));
    } finally {
      setPending(null);
    }
  }

  function submitEmail(e: FormEvent) {
    e.preventDefault();
    if (!isEmail(email) || busy) return;
    void attempt('email', () => p.onEmailSignIn(email.trim()));
  }

  function submitCode(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 8 || busy) return;
    void attempt('code', () => p.onVerifyCode(code));
  }

  return (
    <div className="login">
      <div className="login-brand">
        <span className="brand-tile">
          <BrandMark size={26} />
        </span>
        <h1 className="login-title">Common</h1>
        <p className="login-tagline">A little space for your people.</p>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {p.emailStep === 'email' ? (
          <motion.div
            key="email"
            className="login-body"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <button
              type="button"
              className="btn btn-outline btn-block"
              disabled={!p.authAvailable.google || busy}
              onClick={() => attempt('google', p.onGoogleSignIn)}
            >
              {pending === 'google' ? <Spinner /> : <GoogleG />}
              <span>Continue with Google</span>
            </button>
            {!p.authAvailable.google && !nothingAvailable && <p className="field-note">Google sign-in isn’t configured for this deployment.</p>}

            <div className="or" aria-hidden="true">
              <span>or</span>
            </div>

            <form onSubmit={submitEmail} className="login-form" noValidate>
              <label className="field-label" htmlFor="login-email">
                Email
              </label>
              <input
                ref={emailRef}
                id="login-email"
                className="input"
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                value={email}
                disabled={!p.authAvailable.email || busy}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={shownError ? true : undefined}
              />
              <button type="submit" className="btn btn-primary btn-block" disabled={!p.authAvailable.email || busy || !isEmail(email)}>
                {pending === 'email' && <Spinner />}
                <span>Email me a code</span>
              </button>
              {!p.authAvailable.email && !nothingAvailable && <p className="field-note">Email sign-in isn’t configured for this deployment.</p>}
            </form>
            {nothingAvailable && <p className="field-note warn">Sign-in isn’t configured for this deployment yet.</p>}
          </motion.div>
        ) : (
          <motion.div
            key="code"
            className="login-body"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <form onSubmit={submitCode} className="login-form" noValidate>
              <label className="field-label" htmlFor="login-code">
                Code sent to <strong>{p.emailAddress}</strong>
              </label>
              <input
                ref={codeRef}
                id="login-code"
                className="input code-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={CODE_LENGTH}
                value={code}
                disabled={busy}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
                aria-invalid={shownError ? true : undefined}
              />
              <button type="submit" className="btn btn-primary btn-block" disabled={busy || code.length !== 8}>
                {pending === 'code' && <Spinner />}
                <span>Verify</span>
              </button>
            </form>
            <div className="login-links">
              <button type="button" className="link-btn" onClick={p.onBackToEmail} disabled={busy}>
                <ArrowLeft size={13} aria-hidden="true" />
                Different email
              </button>
              <button type="button" className="link-btn" disabled={busy} onClick={() => attempt('resend', () => p.onEmailSignIn(p.emailAddress))}>
                {pending === 'resend' && <Spinner size={12} />}
                Resend code
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>{shownError && <InlineError key={shownError}>{shownError}</InlineError>}</AnimatePresence>
    </div>
  );
}
