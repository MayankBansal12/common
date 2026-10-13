import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useAnimationControls, useReducedMotion, type PanInfo } from 'motion/react';
import { Check, ChevronLeft, Mail } from 'lucide-react';
import type { CommonUIProps } from '../types';
import { AnimatedMark, Avatar, InlineError, Spinner } from './primitives';
import { AGENTS, AgentAvatar, type Agent } from './agents';
import { useAmbientTint } from './Device';
import { tone } from './palette';
import { errorText, isEmail } from './format';

type Props = Pick<
  CommonUIProps,
  'error' | 'emailStep' | 'emailAddress' | 'authBusy' | 'authAvailable' | 'onGoogleSignIn' | 'onEmailSignIn' | 'onVerifyCode' | 'onBackToEmail' | 'onDismissError' | 'authNotice'
>;

const CODE_LENGTH = 6;
const RESEND_AFTER = 30;
const AUTOPLAY_MS = 5200;
const ease = [0.2, 0.7, 0.2, 1] as const;
const push = { type: 'spring', stiffness: 360, damping: 38, mass: 0.9 } as const;

const CAST = [
  { name: 'Tara', avatarSeed: 'Tara', color: 2 },
  { name: 'Dev', avatarSeed: 'Dev', color: 4 },
  { name: 'Mayank', avatarSeed: 'Mayank', color: 0 },
  { name: 'Noor', avatarSeed: 'Noor', color: 6 },
  { name: 'Sam', avatarSeed: 'Sam', color: 3 },
];

const SLIDES = [
  {
    title: 'You, your people,\nand your agents',
    body: 'Three circles, one common space. A quiet place where you, the people you care about and your agents all meet.',
    tint: 2,
    Art: OrbitArt,
  },
  {
    title: 'Agents, right\nin the thread',
    body: 'Agents post in a space just like people do. What they do is entirely up to you. Out of the box, they do nothing on their own.',
    tint: 6,
    Art: UpdatesArt,
  },
  {
    title: 'Simple pieces.\nMake it yours.',
    body: 'A space, its people and the agents you connect. Easy to set up, and open to whatever you want to build on it.',
    tint: 0,
    Art: PiecesArt,
  },
];

type Stage = 'welcome' | 'email' | 'code';
const ORDER: Stage[] = ['welcome', 'email', 'code'];

function GoogleG() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function LoginScreen(p: Props) {
  const [stage, setStage] = useState<Stage>(p.emailStep === 'code' ? 'code' : 'welcome');
  const [email, setEmail] = useState(p.emailAddress);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pending, setPending] = useState<'google' | 'email' | 'code' | 'resend' | null>(null);
  const prev = useRef(stage);
  const direction = ORDER.indexOf(stage) >= ORDER.indexOf(prev.current) ? 1 : -1;
  useEffect(() => {
    prev.current = stage;
  }, [stage]);

  // The code step is driven by the auth flow; stepping back from it returns to the email step.
  useEffect(() => {
    if (p.emailStep === 'code') setStage('code');
    else setStage((s) => (s === 'code' ? 'email' : s));
  }, [p.emailStep]);
  useEffect(() => {
    if (p.emailAddress) setEmail(p.emailAddress);
  }, [p.emailAddress]);

  const busy = p.authBusy || pending !== null;
  const shownError = localError ?? p.error;
  const nothingAvailable = !p.authAvailable.google && !p.authAvailable.email;

  function go(next: Stage) {
    setLocalError(null);
    if (p.error) p.onDismissError();
    setStage(next);
  }

  async function attempt(kind: NonNullable<typeof pending>, fn: () => Promise<void>) {
    setPending(kind);
    setLocalError(null);
    if (p.error) p.onDismissError();
    try {
      await fn();
      return true;
    } catch (e) {
      setLocalError(errorText(e));
      return false;
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="onb">
      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={stage}
          data-stage={stage}
          className="onb-stage"
          custom={direction}
          variants={{
            enter: (d: number) => ({ x: d > 0 ? '100%' : '-28%', opacity: d > 0 ? 1 : 0.6 }),
            center: { x: 0, opacity: 1 },
            exit: (d: number) => ({ x: d > 0 ? '-28%' : '100%', opacity: d > 0 ? 0.6 : 1 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={push}
          onAnimationComplete={(def) => {
            if (def !== 'center') return;
            // Focus after the push lands; focusing mid-slide makes the browser scroll to reveal the field.
            document.querySelector<HTMLElement>(`.onb-stage[data-stage="${stage}"] [data-autofocus]`)?.focus({ preventScroll: true });
          }}
        >
          {stage === 'welcome' && (
            <Welcome
              busy={busy}
              pending={pending}
              available={p.authAvailable}
              nothingAvailable={nothingAvailable}
              notice={p.authNotice}
              error={shownError}
              onGoogle={() => void attempt('google', p.onGoogleSignIn)}
              onEmail={() => go('email')}
            />
          )}
          {stage === 'email' && (
            <EmailStep
              email={email}
              setEmail={setEmail}
              busy={busy}
              pending={pending === 'email'}
              error={shownError}
              onBack={() => go('welcome')}
              onSubmit={() => void attempt('email', () => p.onEmailSignIn(email.trim()))}
            />
          )}
          {stage === 'code' && (
            <CodeStep
              address={p.emailAddress}
              busy={busy}
              pending={pending}
              error={shownError}
              onBack={() => {
                setLocalError(null);
                p.onBackToEmail();
              }}
              onVerify={(code) => attempt('code', () => p.onVerifyCode(code))}
              onResend={() => attempt('resend', () => p.onEmailSignIn(p.emailAddress))}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ───────── Welcome carousel ───────── */

function Welcome(p: {
  busy: boolean;
  pending: string | null;
  available: { google: boolean; email: boolean };
  nothingAvailable: boolean;
  notice?: string;
  error: string | null;
  onGoogle: () => void;
  onEmail: () => void;
}) {
  const [[index, dir], setPage] = useState<[number, number]>([0, 1]);
  const [autoplay, setAutoplay] = useState(true);
  const reduce = useReducedMotion();
  const slide = SLIDES[index];
  useAmbientTint(slide.tint);

  const paginate = (step: number, manual = true) => {
    if (manual) setAutoplay(false);
    setPage(([i]) => [(i + step + SLIDES.length) % SLIDES.length, step]);
  };

  useEffect(() => {
    if (!autoplay || reduce) return;
    const t = setTimeout(() => paginate(1, false), AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [index, autoplay, reduce]);

  function onDragEnd(_: unknown, info: PanInfo) {
    const swipe = info.offset.x + info.velocity.x * 0.2;
    if (swipe < -60) paginate(1);
    else if (swipe > 60) paginate(-1);
  }

  const t = tone(slide.tint);
  return (
    <div className="onb-welcome">
      <motion.div className="onb-glow" animate={{ background: `radial-gradient(120% 70% at 50% 0%, ${t.bg} 0%, ${t.bg}00 72%)` }} transition={{ duration: 0.8 }} />

      <motion.div className="onb-carousel" drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.18} onDragEnd={onDragEnd}>
        {/* Unlike the stage around it, the first slide animates in, art and all. */}
        <AnimatePresence custom={dir} mode="popLayout">
          <motion.div
            key={index}
            className="onb-slide"
            custom={dir}
            variants={{
              enter: (d: number) => ({ x: d > 0 ? 70 : -70, opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit: (d: number) => ({ x: d > 0 ? -70 : 70, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ x: { type: 'spring', stiffness: 300, damping: 34 }, opacity: { duration: 0.22 } }}
          >
            <div className="onb-art">
              <slide.Art />
            </div>
            <motion.h1 className="onb-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.4, ease }}>
              {slide.title}
            </motion.h1>
            <motion.p className="onb-body" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14, duration: 0.4, ease }}>
              {slide.body}
            </motion.p>
          </motion.div>
        </AnimatePresence>
      </motion.div>

      <div className="onb-dots" role="tablist" aria-label="Introduction">
        {SLIDES.map((s, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Slide ${i + 1} of ${SLIDES.length}`}
            className="onb-dot"
            onClick={() => i !== index && paginate(i - index)}
          >
            <span className="onb-dot-fill">
              {i === index && autoplay && !reduce && (
                <motion.span
                  key={index}
                  className="onb-dot-progress"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: AUTOPLAY_MS / 1000, ease: 'linear' }}
                />
              )}
            </span>
          </button>
        ))}
      </div>

      <motion.div className="onb-cta" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.45, ease }}>
        {p.notice && <p className="onb-notice" role="status">{p.notice}</p>}
        {p.available.google && (
          <button type="button" className="btn btn-primary btn-block btn-xl" disabled={p.busy} onClick={p.onGoogle}>
            {p.pending === 'google' ? <Spinner size={16} /> : <GoogleG />}
            Continue with Google
          </button>
        )}
        {(p.available.email || p.nothingAvailable) && (
          <button
            type="button"
            className={`btn btn-block btn-xl ${p.available.google ? 'btn-soft' : 'btn-primary'}`}
            disabled={p.busy || !p.available.email}
            onClick={p.onEmail}
          >
            <Mail size={17} aria-hidden="true" />
            Continue with email
          </button>
        )}
        {p.nothingAvailable && <p className="field-note warn">Sign-in isn’t configured for this deployment yet.</p>}
        <AnimatePresence>{p.error && <InlineError key={p.error}>{p.error}</InlineError>}</AnimatePresence>
      </motion.div>
    </div>
  );
}

/* ───────── Illustrations ───────── */

const float = (i: number) => ({
  y: [0, -6 - (i % 3) * 2, 0],
  transition: { duration: 3.2 + i * 0.45, repeat: Infinity, ease: 'easeInOut' as const, delay: i * 0.2 },
});

/** Three circles drift together into the Common mark while people and agents gather around it. */
function OrbitArt() {
  const spots: { x: number; y: number; s: number; agent?: Agent['id']; who?: number }[] = [
    { x: -106, y: -50, s: 50, who: 0 },
    { x: 100, y: -66, s: 46, agent: 'claude' },
    { x: 120, y: 42, s: 50, who: 1 },
    { x: -118, y: 60, s: 44, agent: 'chatgpt' },
    { x: 4, y: 104, s: 40, who: 3 },
    { x: -14, y: -112, s: 34, who: 4 },
  ];
  return (
    <div className="art art-orbit" aria-hidden="true">
      <motion.span className="art-ring" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.9, ease }} />
      <motion.span className="art-ring r2" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 1.1, ease, delay: 0.05 }} />
      <motion.span className="art-mark" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
        <AnimatedMark size={70} />
      </motion.span>
      {spots.map((spot, i) => (
        <motion.span
          key={i}
          className="art-face"
          style={{ left: `calc(50% + ${spot.x}px)`, top: `calc(50% + ${spot.y}px)` }}
          initial={{ scale: 0, opacity: 0, x: '-50%', y: '-50%' }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.45 + i * 0.09 }}
        >
          <motion.span animate={float(i)} style={{ display: 'block' }}>
            {spot.agent ? <AgentAvatar agent={spot.agent} size={spot.s} /> : <Avatar person={CAST[spot.who ?? 0]} size={spot.s} />}
          </motion.span>
        </motion.span>
      ))}
    </div>
  );
}

/** An agent's message is an ordinary message: same bubble, same name underneath, exactly as the chat shows it. */
const AGENT_TONE: Record<Agent['id'], number> = { chatgpt: 7, claude: 6 };

function UpdatesArt() {
  const items: { agent?: Agent['id']; who?: number; text: string; mine?: boolean }[] = [
    { agent: 'claude', text: 'Morning! 3 new ideas landed on the board overnight.' },
    { agent: 'chatgpt', text: 'Build finished, v0.4 is live ✓' },
    { who: 2, text: 'Nice 🙌', mine: true },
  ];
  return (
    <div className="art art-chat" aria-hidden="true">
      {items.map((l, i) => {
        const t = tone(l.agent ? AGENT_TONE[l.agent] : CAST[l.who ?? 0].color);
        const name = l.agent ? AGENTS.find((a) => a.id === l.agent)?.name : CAST[l.who ?? 0].name;
        return (
          <motion.div
            key={i}
            className={`art-msg${l.mine ? ' mine' : ''}`}
            initial={{ opacity: 0, y: 14, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26, delay: 0.25 + i * 0.6 }}
          >
            {l.agent && (
              <span className="art-who">
                <AgentAvatar agent={l.agent} size={26} />
                <span className="art-name">{name}</span>
              </span>
            )}
            <span className="art-bubble" style={{ background: t.bg, color: t.ink }}>
              {l.text}
            </span>
          </motion.div>
        );
      })}
      <motion.div className="art-msg" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.1, duration: 0.3 }}>
        <span className="art-who">
          <Avatar person={CAST[0]} size={26} />
          <span className="art-name">{CAST[0].name}</span>
        </span>
        <span className="art-bubble art-typing" style={{ background: tone(CAST[0].color).bg }}>
          {[0, 1, 2].map((d) => (
            <motion.i key={d} animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.15 }} />
          ))}
        </span>
      </motion.div>
    </div>
  );
}

/** The building blocks snap together: a space, its people, its agents. */
function PiecesArt() {
  const piece = (i: number) => ({
    initial: { opacity: 0, y: 26, scale: 0.94 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { type: 'spring' as const, stiffness: 300, damping: 24, delay: 0.2 + i * 0.32 },
  });
  return (
    <div className="art art-pieces" aria-hidden="true">
      <motion.div className="art-piece" {...piece(0)}>
        <span className="art-badge">✳</span>
        <span className="art-piece-text">
          <b>The studio</b>
          <small>Space</small>
        </span>
      </motion.div>
      <motion.span className="art-link" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.5, duration: 0.3 }} />
      <motion.div className="art-piece" {...piece(1)}>
        <span className="art-faces">
          {CAST.slice(0, 4).map((c) => (
            <Avatar key={c.name} person={c} size={28} className="stacked" />
          ))}
        </span>
        <span className="art-piece-text">
          <b>4 people</b>
          <small>Invited by email</small>
        </span>
      </motion.div>
      <motion.span className="art-link" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.82, duration: 0.3 }} />
      <motion.div className="art-piece" {...piece(2)}>
        <span className="art-faces">
          {AGENTS.map((a) => (
            <AgentAvatar key={a.id} agent={a.id} size={28} className="stacked" />
          ))}
        </span>
        <span className="art-piece-text">
          <b>2 agents</b>
          <small>Set up your way</small>
        </span>
      </motion.div>
    </div>
  );
}

/* ───────── Email & code steps ───────── */

function StepFrame({ onBack, backDisabled, title, sub, children, cta }: { onBack: () => void; backDisabled?: boolean; title: string; sub: ReactNode; children: ReactNode; cta: ReactNode }) {
  return (
    <div className="onb-step">
      <div className="onb-nav">
        <button type="button" className="icon-btn" aria-label="Back" title="Back" onClick={onBack} disabled={backDisabled}>
          <ChevronLeft size={21} />
        </button>
      </div>
      <div className="onb-step-body">
        <motion.h1 className="onb-h" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.4, ease }}>
          {title}
        </motion.h1>
        <motion.p className="onb-sub" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, duration: 0.4, ease }}>
          {sub}
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24, duration: 0.4, ease }}>
          {children}
        </motion.div>
      </div>
      <div className="onb-cta">{cta}</div>
    </div>
  );
}

function EmailStep(p: { email: string; setEmail: (v: string) => void; busy: boolean; pending: boolean; error: string | null; onBack: () => void; onSubmit: () => void }) {
  const valid = isEmail(p.email);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (valid && !p.busy) p.onSubmit();
  }
  return (
    <form className="onb-form" onSubmit={submit} noValidate>
      <StepFrame
        onBack={p.onBack}
        backDisabled={p.busy}
        title="What’s your email?"
        sub="We’ll send you a sign-in code. No passwords to remember."
        cta={
          <button type="submit" className="btn btn-primary btn-block btn-xl" disabled={p.busy || !valid}>
            {p.pending && <Spinner size={16} />}
            Send code
          </button>
        }
      >
        <label className="sr-only" htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          className="onb-input"
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          placeholder="you@example.com"
          value={p.email}
          disabled={p.busy}
          onChange={(e) => p.setEmail(e.target.value)}
          aria-invalid={p.error ? true : undefined}
          data-autofocus
        />
        <AnimatePresence>{p.error && <InlineError key={p.error}>{p.error}</InlineError>}</AnimatePresence>
      </StepFrame>
    </form>
  );
}

function CodeStep(p: {
  address: string;
  busy: boolean;
  pending: string | null;
  error: string | null;
  onBack: () => void;
  onVerify: (code: string) => Promise<boolean>;
  onResend: () => Promise<boolean>;
}) {
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(false);
  const [wait, setWait] = useState(RESEND_AFTER);
  const [verified, setVerified] = useState(false);
  const shake = useAnimationControls();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function verify(value: string) {
    if (value.length !== CODE_LENGTH || p.busy) return;
    if (await p.onVerify(value)) {
      setVerified(true);
      return;
    }
    void shake.start({ x: [0, -10, 9, -7, 5, -2, 0], transition: { duration: 0.42 } });
    setCode('');
    input.current?.focus({ preventScroll: true });
  }

  return (
    <form
      className="onb-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void verify(code);
      }}
    >
      <StepFrame
        onBack={p.onBack}
        backDisabled={p.busy}
        title="Check your inbox"
        sub={
          <>
            Enter the {CODE_LENGTH}-digit code we sent to
            <strong className="onb-address">{p.address}</strong>
          </>
        }
        cta={
          <>
            <button type="submit" className="btn btn-primary btn-block btn-xl" disabled={p.busy || code.length !== CODE_LENGTH}>
              {p.pending === 'code' && <Spinner size={16} />}
              {verified ? <Check size={17} /> : 'Verify'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-block"
              disabled={p.busy || wait > 0}
              onClick={async () => {
                if (await p.onResend()) setWait(RESEND_AFTER);
              }}
            >
              {p.pending === 'resend' && <Spinner size={13} />}
              {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
            </button>
          </>
        }
      >
        <motion.div className="otp" animate={shake} onClick={() => input.current?.focus()}>
          <input
            ref={input}
            id="login-code"
            className="otp-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={CODE_LENGTH}
            value={code}
            readOnly={p.busy} // not disabled: keeping focus lets the next attempt be typed straight away
            aria-label={`${CODE_LENGTH}-digit code`}
            aria-invalid={p.error ? true : undefined}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              const next = e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
              setCode(next);
              if (next.length === CODE_LENGTH) void verify(next);
            }}
            data-autofocus
          />
          {Array.from({ length: CODE_LENGTH }, (_, i) => {
            const ch = code[i];
            const active = focused && (i === code.length || (i === CODE_LENGTH - 1 && code.length === CODE_LENGTH));
            return (
              <span key={i} className="otp-slot" data-filled={ch ? true : undefined} data-active={active || undefined} data-ok={verified || undefined}>
                <AnimatePresence initial={false}>
                  {ch && (
                    <motion.span key={ch + i} initial={{ y: 8, opacity: 0, scale: 0.7 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 30 }}>
                      {ch}
                    </motion.span>
                  )}
                </AnimatePresence>
                {active && !ch && <span className="otp-caret" />}
              </span>
            );
          })}
        </motion.div>
        <AnimatePresence>{p.error && <InlineError key={p.error}>{p.error}</InlineError>}</AnimatePresence>
      </StepFrame>
    </form>
  );
}
