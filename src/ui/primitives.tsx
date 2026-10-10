import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react';
import { LoaderCircle, X } from 'lucide-react';
import type { Person } from '../types';
import { tone } from './palette';
import { useScreenContainer, useSheetStack } from './Device';

/** Three overlapping circles: you, your people and your agents. The shared centre is filled. */
export const MARK_R = 5.4;
export const MARK_CIRCLES = [
  { cx: 12, cy: 8.9 },
  { cx: 8.4, cy: 15.1 },
  { cx: 15.6, cy: 15.1 },
] as const;

export function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  const [a, b, c] = MARK_CIRCLES;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <clipPath id={`cm-a-${id}`}>
          <circle cx={a.cx} cy={a.cy} r={MARK_R} />
        </clipPath>
        <clipPath id={`cm-b-${id}`} clipPath={`url(#cm-a-${id})`}>
          <circle cx={b.cx} cy={b.cy} r={MARK_R} />
        </clipPath>
      </defs>
      <circle cx={c.cx} cy={c.cy} r={MARK_R} fill="currentColor" clipPath={`url(#cm-b-${id})`} />
      {MARK_CIRCLES.map((p, i) => (
        <circle key={i} cx={p.cx} cy={p.cy} r={MARK_R} stroke="currentColor" strokeWidth="1.5" />
      ))}
    </svg>
  );
}

type AvatarEngine = typeof import('./avatarEngine');
let engine: AvatarEngine | null = null;
let engineLoad: Promise<AvatarEngine> | null = null;
function loadEngine() {
  engineLoad ??= import('./avatarEngine').then((m) => (engine = m));
  return engineLoad;
}
if (typeof window !== 'undefined') void loadEngine().catch(() => {});

function useAvatarEngine() {
  const [ready, setReady] = useState(engine);
  useEffect(() => {
    if (ready) return;
    let live = true;
    loadEngine().then((m) => live && setReady(m), () => {});
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
}

export function Avatar({ person, size = 20, label, className }: { person: Pick<Person, 'avatarSeed' | 'color' | 'name' | 'imageUrl'>; size?: number; label?: string; className?: string }) {
  const eng = useAvatarEngine();
  const generated = useMemo(() => eng?.avatarUri(person.avatarSeed, person.color), [eng, person.avatarSeed, person.color]);
  const uri = person.imageUrl ?? generated;
  if (!uri) {
    const t = tone(person.color);
    return (
      <span
        className={`avatar avatar-fallback ${className ?? ''}`}
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)), background: t.soft, color: t.ink }}
      >
        {person.name.trim().charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className={`avatar${person.imageUrl ? ' is-photo' : ''} ${className ?? ''}`}
      src={uri}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      alt={label ?? ''}
      draggable={false}
    />
  );
}

export function SpaceBadge({ symbol, name, color, imageUrl, size = 32 }: { symbol: string; name: string; color: number; imageUrl?: string; size?: number }) {
  const t = tone(color);
  const glyph = symbol?.trim() || name.trim().charAt(0).toUpperCase() || '·';
  if (imageUrl) {
    return <img className="space-badge is-photo" src={imageUrl} alt="" aria-hidden="true" width={size} height={size} style={{ width: size, height: size }} draggable={false} />;
  }
  return (
    <span
      className="space-badge"
      aria-hidden="true"
      style={{ '--badge-bg': t.soft, '--badge-ink': t.ink, width: size, height: size, fontSize: Math.round(size * 0.5) } as CSSProperties}
    >
      {glyph}
    </span>
  );
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={`spin ${className ?? ''}`} aria-hidden="true" />;
}

export function InlineError({ children, id }: { children: ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <motion.p
      id={id}
      className="inline-error"
      role="alert"
      initial={{ opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
    >
      {children}
    </motion.p>
  );
}

const sheetSpring = { type: 'spring', stiffness: 420, damping: 40, mass: 0.9 } as const;

/**
 * A bottom sheet that springs up from the bottom of the screen. Drag the grabber or header down to dismiss.
 * `onExitComplete` fires once it has fully slid away — use it to navigate after closing.
 */
export function Sheet({
  open,
  onOpenChange,
  onExitComplete,
  title,
  titleAddon,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExitComplete?: () => void;
  title: ReactNode;
  titleAddon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  // Dialogs open from state rather than a Radix Trigger, so restore focus to whatever opened them.
  const returnTo = useRef<HTMLElement | null>(null);
  const container = useScreenContainer();
  const drag = useDragControls();
  const sheetRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useSheetStack(open);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence onExitComplete={onExitComplete}>
        {open && (
          <Dialog.Portal forceMount container={container}>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.24 }} />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              forceMount
              aria-describedby={undefined}
              onOpenAutoFocus={(e) => {
                returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                // Focus once the sheet has arrived: focusing mid-slide makes the browser scroll the screen to reveal the field.
                e.preventDefault();
              }}
              onCloseAutoFocus={(e) => {
                const el = returnTo.current;
                if (el?.isConnected) {
                  e.preventDefault();
                  el.focus({ preventScroll: true });
                }
              }}
            >
              <motion.div
                ref={sheetRef}
                className={`sheet ${className ?? ''}`}
                initial={reduce ? { opacity: 0 } : { y: '100%' }}
                animate={reduce ? { opacity: 1 } : { y: 0 }}
                exit={reduce ? { opacity: 0 } : { y: '100%', transition: { type: 'spring', stiffness: 420, damping: 44 } }}
                transition={sheetSpring}
                drag={reduce ? false : 'y'}
                dragListener={false}
                dragControls={drag}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0.04, bottom: 0.9 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 110 || info.velocity.y > 520) onOpenChange(false);
                }}
                onAnimationComplete={() => {
                  // Entered: move focus to the sheet's autofocus target (or the sheet itself) without scrolling.
                  const sheet = sheetRef.current;
                  if (!open || !sheet || sheet.contains(document.activeElement)) return;
                  (sheet.querySelector<HTMLElement>('[data-autofocus]') ?? sheet).focus({ preventScroll: true });
                }}
              >
                <div className="sheet-grab" onPointerDown={(e) => drag.start(e)}>
                  <span className="sheet-grabber" aria-hidden="true" />
                  <div className="sheet-head">
                    {titleAddon}
                    <Dialog.Title className="sheet-title">{title}</Dialog.Title>
                    <Dialog.Close asChild>
                      <button type="button" className="icon-btn sm sheet-close" aria-label="Close" title="Close" onPointerDown={(e) => e.stopPropagation()}>
                        <X size={15} />
                      </button>
                    </Dialog.Close>
                  </div>
                </div>
                {children}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
