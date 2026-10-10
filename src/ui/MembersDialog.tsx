import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Mail, PenLine, Sparkles, UserMinus, UserPlus, UserRoundCheck, UserRoundX, X } from 'lucide-react';
import type { Activity, Invitation, Person, Space } from '../types';
import { Avatar, InlineError, Sheet, SpaceBadge, Spinner } from './primitives';
import { ago, errorText, isEmail } from './format';
import { useAction } from './hooks';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: Space;
  user: Person;
  members: Person[];
  invitations: Invitation[];
  activities: Activity[];
  onInvite: (email: string) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
};

type Tab = 'members' | 'activity';

export function MembersDialog(p: Props) {
  const [tab, setTab] = useState<Tab>('members');
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (p.open) setTab('members');
  }, [p.open]);

  function onTabKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next: Tab = tab === 'members' ? 'activity' : 'members';
    setTab(next);
    tabsRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
  }

  return (
    <Sheet
      open={p.open}
      onOpenChange={p.onOpenChange}
      className="members-sheet"
      titleAddon={<SpaceBadge symbol={p.space.symbol} name={p.space.name} color={p.space.color} imageUrl={p.space.imageUrl} size={26} />}
      title={p.space.name}
    >
      <div className="tabs" role="tablist" aria-label="Space details" ref={tabsRef} onKeyDown={onTabKey}>
        {(['members', 'activity'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            data-tab={t}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            className="tab"
            onClick={() => setTab(t)}
          >
            {t === 'members' ? 'Members' : 'Activity'}
            {t === 'members' && <span className="tab-count">{p.members.length}</span>}
            {tab === t && <motion.span layoutId="tab-ink" className="tab-ink" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          </button>
        ))}
      </div>

      <div className="sheet-scroll">
        {tab === 'members' ? (
          <div role="tabpanel" id="panel-members" aria-labelledby="tab-members">
            <MembersPanel {...p} />
          </div>
        ) : (
          <div role="tabpanel" id="panel-activity" aria-labelledby="tab-activity">
            <ActivityPanel activities={p.activities} />
          </div>
        )}
      </div>
    </Sheet>
  );
}

function MembersPanel(p: Props) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const invite = useAction();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const me = p.members.find((m) => m.id === p.user.id);
  const isOwner = (me?.role ?? p.user.role) === 'owner';

  const members = useMemo(
    () =>
      [...p.members].sort((a, b) => {
        const ra = a.role === 'owner' ? 0 : 1;
        const rb = b.role === 'owner' ? 0 : 1;
        if (ra !== rb) return ra - rb;
        if (a.id === p.user.id) return -1;
        if (b.id === p.user.id) return 1;
        return a.name.localeCompare(b.name);
      }),
    [p.members, p.user.id],
  );

  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => setSent(false), 2200);
    return () => clearTimeout(t);
  }, [sent]);

  async function submitInvite(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!isEmail(value) || invite.busy) return;
    if (await invite.run(() => p.onInvite(value))) {
      setEmail('');
      setSent(true);
    }
  }

  async function rowAction(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setRowError(null);
    try {
      await fn();
      setConfirmId(null);
    } catch (e) {
      setRowError({ id, message: errorText(e) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="stack">
      <form className="invite-form" onSubmit={submitInvite} noValidate>
        <label htmlFor="invite-email" className="sr-only">
          Invite by email
        </label>
        <div className="input-with-btn">
          <input
            id="invite-email"
            className="input"
            type="email"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            placeholder="Invite by email"
            value={email}
            disabled={invite.busy}
            onChange={(e) => {
              setEmail(e.target.value);
              if (invite.error) invite.setError(null);
            }}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={invite.busy || !isEmail(email)}>
            {invite.busy ? <Spinner size={12} /> : sent ? <Check size={13} aria-hidden="true" /> : <UserPlus size={13} aria-hidden="true" />}
            {sent ? 'Sent' : 'Invite'}
          </button>
        </div>
        <InlineError>{invite.error}</InlineError>
      </form>

      <ul className="list people">
        {members.map((m) => {
          const confirming = confirmId === m.id;
          const canRemove = isOwner && m.id !== p.user.id && m.role !== 'owner';
          return (
            <li key={m.id} className="person-row" data-confirm={confirming || undefined}>
              <Avatar person={m} size={30} />
              <div className="row-main">
                <span className="row-title">
                  {m.name}
                  {m.id === p.user.id && <span className="you-tag">you</span>}
                </span>
                <span className="row-sub">{m.email}</span>
                {rowError?.id === m.id && (
                  <span className="inline-error tight" role="alert">
                    {rowError.message}
                  </span>
                )}
              </div>
              <AnimatePresence mode="popLayout" initial={false}>
                {confirming ? (
                  <motion.div
                    key="confirm"
                    className="confirm"
                    initial={{ opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 6 }}
                    transition={{ duration: 0.14 }}
                    role="group"
                    aria-label={`Remove ${m.name}?`}
                  >
                    <button type="button" className="btn btn-ghost btn-sm" autoFocus disabled={busyId === m.id} onClick={() => setConfirmId(null)}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn-danger btn-sm" disabled={busyId === m.id} onClick={() => rowAction(m.id, () => p.onRemove(m.id))}>
                      {busyId === m.id && <Spinner size={12} />}
                      Remove
                    </button>
                  </motion.div>
                ) : (
                  <motion.div key="idle" className="row-side-inline" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                    {m.role === 'owner' && <span className="role-chip">Owner</span>}
                    {canRemove && (
                      <button
                        type="button"
                        className="icon-btn sm subtle"
                        aria-label={`Remove ${m.name}`}
                        title="Remove from space"
                        onClick={() => {
                          setRowError(null);
                          setConfirmId(m.id);
                        }}
                      >
                        <UserMinus size={14} />
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>

      {p.invitations.length > 0 && (
        <section aria-labelledby="pending-h">
          <h3 id="pending-h" className="section-label">
            Pending
          </h3>
          <ul className="list people">
            {p.invitations.map((inv) => (
              <li key={inv.id} className="person-row">
                <span className="mail-badge" aria-hidden="true">
                  <Mail size={13} />
                </span>
                <div className="row-main">
                  <span className="row-title">{inv.email}</span>
                  <span className="row-sub">Invited {ago(inv.createdAt)}</span>
                  {rowError?.id === inv.id && (
                    <span className="inline-error tight" role="alert">
                      {rowError.message}
                    </span>
                  )}
                </div>
                {inv.canRevoke !== false && <button
                  type="button"
                  className="icon-btn sm subtle"
                  aria-label={`Revoke invitation for ${inv.email}`}
                  title="Revoke invitation"
                  disabled={busyId === inv.id}
                  onClick={() => rowAction(inv.id, () => p.onRevoke(inv.id))}
                >
                  {busyId === inv.id ? <Spinner size={13} /> : <X size={14} />}
                </button>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const ACTIVITY_ICON = {
  space_created: Sparkles,
  member_invited: Mail,
  member_joined: UserRoundCheck,
  member_removed: UserRoundX,
  invite_revoked: X,
  space_updated: PenLine,
} as const;

function activityText(a: Activity) {
  const s = a.subject ? ` ${a.subject}` : '';
  switch (a.kind) {
    case 'space_created':
      return <><strong>{a.actorName}</strong> created the space</>;
    case 'member_invited':
      return <><strong>{a.actorName}</strong> invited{s}</>;
    case 'member_joined':
      return <><strong>{a.actorName}</strong> joined</>;
    case 'member_removed':
      return <><strong>{a.actorName}</strong> removed{s}</>;
    case 'invite_revoked':
      return <><strong>{a.actorName}</strong> revoked the invite for{s || ' someone'}</>;
    case 'space_updated':
      return a.subject ? <><strong>{a.actorName}</strong> renamed the space to{s}</> : <><strong>{a.actorName}</strong> updated the space</>;
  }
}

function ActivityPanel({ activities }: { activities: Activity[] }) {
  const items = useMemo(() => [...activities].sort((a, b) => b.createdAt - a.createdAt), [activities]);
  if (items.length === 0) return <p className="muted small pad">No activity yet.</p>;
  return (
    <ol className="activity">
      {items.map((a) => {
        const Icon = ACTIVITY_ICON[a.kind] ?? Sparkles;
        return (
          <li key={a.id} className="activity-row">
            <span className="activity-icon" aria-hidden="true">
              <Icon size={12} />
            </span>
            <span className="activity-text">{activityText(a)}</span>
            <time className="activity-time" dateTime={new Date(a.createdAt).toISOString()}>
              {ago(a.createdAt)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
