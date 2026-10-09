import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import type { Person } from '../types';
import { SYMBOLS, TONES } from './palette';
import { useAction } from './hooks';
import { Avatar, InlineError, Sheet, SpaceBadge, Spinner } from './primitives';

export function CreateSpaceDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, symbol: string, color: number) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState(SYMBOLS[0]);
  const [color, setColor] = useState(0);
  const { busy, error, setError, run } = useAction();

  useEffect(() => {
    if (open) {
      setName('');
      setSymbol(SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
      setColor(Math.floor(Math.random() * TONES.length));
      setError(null);
    }
  }, [open, setError]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    if (await run(() => onCreate(trimmed, symbol, color))) onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="New space">
      <form className="sheet-body stack" onSubmit={submit}>
        <div className="name-row">
          <SpaceBadge symbol={symbol} name={name} color={color} size={40} />
          <div className="grow">
            <label className="field-label" htmlFor="space-name">
              Name
            </label>
            <input
              id="space-name"
              className="input"
              value={name}
              maxLength={60}
              autoComplete="off"
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <fieldset className="picker" disabled={busy}>
          <legend className="field-label">Symbol</legend>
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

        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy && <Spinner />}
            Create
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function ProfileDialog({
  open,
  onOpenChange,
  user,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: Person;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(user.name);
  const { busy, error, setError, run } = useAction();

  useEffect(() => {
    if (open) {
      setName(user.name);
      setError(null);
    }
  }, [open, user.name, setError]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    if (trimmed === user.name) return onOpenChange(false);
    if (await run(() => onSave(trimmed))) onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Profile">
      <form className="sheet-body stack" onSubmit={submit}>
        <div className="name-row">
          <Avatar person={user} size={44} />
          <div className="grow">
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
              autoFocus
            />
          </div>
        </div>
        <p className="muted small">{user.email}</p>
        <InlineError>{error}</InlineError>
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy && <Spinner />}
            Save
          </button>
        </div>
      </form>
    </Sheet>
  );
}
