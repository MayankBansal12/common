import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion } from 'motion/react';
import { LoaderCircle, X } from 'lucide-react';
import type { Person } from '../types';
import { tone } from './palette';

/** Two overlapping circles; the shared lens is filled — the "common" ground. */
export function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <clipPath id={`cm-${id}`}>
          <circle cx="9" cy="12" r="6.25" />
        </clipPath>
      </defs>
      <circle cx="15" cy="12" r="6.25" fill="currentColor" clipPath={`url(#cm-${id})`} />
      <circle cx="9" cy="12" r="6.25" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15" cy="12" r="6.25" stroke="currentColor" strokeWidth="1.6" />
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

export function Avatar({ person, size = 20, label, className }: { person: Pick<Person, 'avatarSeed' | 'color' | 'name'>; size?: number; label?: string; className?: string }) {
  const eng = useAvatarEngine();
  const uri = useMemo(() => eng?.avatarUri(person.avatarSeed, person.color), [eng, person.avatarSeed, person.color]);
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
      className={`avatar ${className ?? ''}`}
      src={uri}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      alt={label ?? ''}
      draggable={false}
    />
  );
}

export function SpaceBadge({ symbol, name, color, size = 32 }: { symbol: string; name: string; color: number; size?: number }) {
  const t = tone(color);
  const glyph = symbol?.trim() || name.trim().charAt(0).toUpperCase() || '·';
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

export function Sheet({
  open,
  onOpenChange,
  title,
  titleAddon,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  titleAddon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  // Dialogs open from state rather than a Radix Trigger, so restore focus to whatever opened them.
  const returnTo = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className={`sheet ${className ?? ''}`}
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(e) => {
            const el = returnTo.current;
            if (el?.isConnected) {
              e.preventDefault();
              el.focus();
            }
          }}
        >
          <div className="sheet-head">
            {titleAddon}
            <Dialog.Title className="sheet-title">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="icon-btn sm" aria-label="Close" title="Close">
                <X size={15} />
              </button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
