import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Camera, Shuffle } from 'lucide-react';
import type { Person, ProfileInput, Space, SpaceInput } from '../types';
import { SYMBOLS, TONES } from './palette';
import { useAction } from './hooks';
import { errorText } from './format';
import { squareImage } from './image';
import { Avatar, InlineError, Sheet, SpaceBadge, Spinner } from './primitives';

const AVATAR_CHOICES = 10;
const randomSeeds = (n: number) => Array.from({ length: n }, () => Math.random().toString(36).slice(2, 10));

/** A photo being edited: `image` is undefined (unchanged), null (removed) or a new, already-cropped Blob. */
function usePhotoDraft(current: string | undefined, open: boolean) {
  const [image, setImage] = useState<Blob | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const draftUrl = useMemo(() => (image ? URL.createObjectURL(image) : undefined), [image]);
  useEffect(() => () => (draftUrl ? URL.revokeObjectURL(draftUrl) : undefined), [draftUrl]);
  useEffect(() => {
    if (open) {
      setImage(undefined);
      setError(null);
    }
  }, [open]);
  async function pick(file: File) {
    setError(null);
    setReading(true);
    try {
      setImage(await squareImage(file));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setReading(false);
    }
  }
  return { image, shown: image === undefined ? current : draftUrl, error, reading, pick, remove: () => setImage(null) };
}

function PhotoPicker({ photo, disabled, faceKey, children }: { photo: ReturnType<typeof usePhotoDraft>; disabled?: boolean; faceKey?: string; children: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const choose = () => input.current?.click();
  return (
    <div className="photo-pick">
      <button type="button" className="photo-target" onClick={choose} disabled={disabled} aria-label={photo.shown ? 'Change photo' : 'Add photo'}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={photo.shown ?? faceKey ?? 'none'}
            className="photo-face"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          >
            {children}
          </motion.span>
        </AnimatePresence>
        <span className="photo-cam" aria-hidden="true">
          {photo.reading ? <Spinner size={13} /> : <Camera size={14} />}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void photo.pick(file);
        }}
      />
      <div className="photo-actions">
        <button type="button" className="link-btn" onClick={choose} disabled={disabled}>
          {photo.shown ? 'Change photo' : 'Add photo'}
        </button>
        {photo.shown && (
          <button type="button" className="link-btn quiet" onClick={photo.remove} disabled={disabled}>
            Remove
          </button>
        )}
      </div>
      <InlineError>{photo.error}</InlineError>
    </div>
  );
}

/** Create a space, or edit the active one when `space` is given. */
export function SpaceSheet({
  open,
  onOpenChange,
  onExitComplete,
  space,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExitComplete?: () => void;
  space?: Space;
  onSubmit: (input: SpaceInput) => Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState(SYMBOLS[0]);
  const [color, setColor] = useState(0);
  const photo = usePhotoDraft(space?.imageUrl, open);
  const { busy, error, setError, run } = useAction();

  useEffect(() => {
    if (!open) return;
    setName(space?.name ?? '');
    setSymbol(space?.symbol ?? SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
    setColor(space?.color ?? Math.floor(Math.random() * TONES.length));
    setError(null);
    // Reset only when the sheet opens, not when the space updates underneath an open editor.
  }, [open, setError]);

  const unchanged = space && name.trim() === space.name && symbol === space.symbol && color === space.color && photo.image === undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy || photo.reading) return;
    if (unchanged) return onOpenChange(false);
    const input: SpaceInput = { name: trimmed, symbol, color, ...(photo.image !== undefined && { image: photo.image }) };
    if (await run(() => onSubmit(input))) onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} onExitComplete={onExitComplete} title={space ? 'Edit space' : 'New space'}>
      <form className="sheet-body stack" onSubmit={submit}>
        <PhotoPicker photo={photo} disabled={busy}>
          <SpaceBadge symbol={symbol} name={name} color={color} imageUrl={photo.shown} size={84} />
        </PhotoPicker>

        <div>
          <label className="field-label" htmlFor="space-name">
            Name
          </label>
          <input
            id="space-name"
            className="input"
            value={name}
            maxLength={60}
            autoComplete="off"
            placeholder="Weekend plans, The studio…"
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            data-autofocus={space ? undefined : true}
          />
        </div>

        <fieldset className="picker" disabled={busy}>
          <legend className="field-label">
            Icon {photo.shown && <span className="field-hint">· shown when there’s no photo</span>}
          </legend>
          <div className="symbol-grid">
            {SYMBOLS.map((s) => (
              <label key={s} className="symbol-opt" data-selected={s === symbol || undefined}>
                <input type="radio" name="symbol" className="sr-only" value={s} checked={s === symbol} onChange={() => setSymbol(s)} />
                <span aria-hidden="true">{s}</span>
                <span className="sr-only">{s}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="picker" disabled={busy}>
          <legend className="field-label">Color</legend>
          <div className="swatch-row">
            {TONES.map((t, i) => (
              <label
                key={t.name}
                className="swatch"
                title={t.name}
                data-selected={i === color || undefined}
                style={{ '--sw': t.soft, '--sw-ring': t.strong } as CSSProperties}
              >
                <input type="radio" name="color" className="sr-only" value={i} checked={i === color} onChange={() => setColor(i)} />
                <span className="sr-only">{t.name}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <InlineError>{error}</InlineError>

        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy || photo.reading || !name.trim()}>
          {busy && <Spinner />}
          {space ? 'Save changes' : 'Create space'}
        </button>
      </form>
    </Sheet>
  );
}

export function ProfileSheet({
  open,
  onOpenChange,
  user,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: Person;
  onSave: (input: ProfileInput) => Promise<void>;
}) {
  const [name, setName] = useState(user.name);
  const [seed, setSeed] = useState(user.avatarSeed);
  const [choices, setChoices] = useState<string[]>([]);
  const photo = usePhotoDraft(user.imageUrl, open);
  const { busy, error, setError, run } = useAction();

  useEffect(() => {
    if (open) {
      setName(user.name);
      setSeed(user.avatarSeed);
      setChoices([user.avatarSeed, ...randomSeeds(AVATAR_CHOICES - 1)]);
      setError(null);
    }
  }, [open, setError]);

  // Picking an avatar replaces any photo, so the avatar is what people see.
  function chooseAvatar(next: string) {
    setSeed(next);
    if (photo.shown) photo.remove();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy || photo.reading) return;
    if (trimmed === user.name && photo.image === undefined && seed === user.avatarSeed) return onOpenChange(false);
    const input: ProfileInput = {
      name: trimmed,
      ...(photo.image !== undefined && { image: photo.image }),
      ...(seed !== user.avatarSeed && { avatarSeed: seed }),
    };
    if (await run(() => onSave(input))) onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Edit profile">
      <form className="sheet-body stack" onSubmit={submit}>
        <PhotoPicker photo={photo} disabled={busy} faceKey={seed}>
          <Avatar person={{ ...user, name: name || user.name, avatarSeed: seed, imageUrl: photo.shown }} size={84} />
        </PhotoPicker>
        <div>
          <div className="field-row">
            <span className="field-label" id="avatar-label">
              {photo.shown ? 'Or pick an avatar' : 'Avatar'}
            </span>
            <button type="button" className="link-btn" disabled={busy} onClick={() => setChoices([seed, ...randomSeeds(AVATAR_CHOICES - 1)])}>
              <Shuffle size={12} aria-hidden="true" />
              Shuffle
            </button>
          </div>
          <div className="avatar-grid" role="radiogroup" aria-labelledby="avatar-label">
            {choices.map((c, i) => (
              <motion.button
                key={c}
                type="button"
                role="radio"
                aria-checked={!photo.shown && c === seed}
                aria-label={`Avatar ${i + 1}`}
                className="avatar-opt"
                disabled={busy}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 520, damping: 28, delay: i * 0.025 }}
                onClick={() => chooseAvatar(c)}
              >
                <Avatar person={{ ...user, avatarSeed: c, imageUrl: undefined }} size={46} />
              </motion.button>
            ))}
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="profile-name">
            Display name
          </label>
          <input
            id="profile-name"
            className="input"
            value={name}
            maxLength={40}
            autoComplete="name"
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <span className="field-label">Email</span>
          <p className="readonly-field">{user.email}</p>
        </div>
        <InlineError>{error}</InlineError>
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy || photo.reading || !name.trim()}>
          {busy && <Spinner />}
          Save changes
        </button>
      </form>
    </Sheet>
  );
}
