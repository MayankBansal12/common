import { useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { motion } from 'motion/react';
import { Check, LogOut, PenLine, Plus, Users } from 'lucide-react';
import type { PendingInvitation, Person, ProfileInput, Space, SpaceInput } from '../types';
import { AnimatedMark, Avatar, BrandMark, SpaceBadge, Spinner } from './primitives';
import { ProfileSheet, SpaceSheet } from './SpaceDialogs';
import { useScreenContainer } from './Device';
import { plainText } from './markdown';
import { errorText, shortStamp } from './format';

type Props = {
  /** The list hasn't loaded yet: show placeholders rather than the first-space welcome. */
  isLoading?: boolean;
  user: Person;
  spaces: Space[];
  pendingInvitations: PendingInvitation[];
  isOnline: boolean;
  onSelectSpace: (id: string) => void;
  onCreateSpace: (input: SpaceInput) => Promise<string>;
  onAcceptInvitation: (id: string) => Promise<void>;
  onUpdateProfile: (input: ProfileInput) => Promise<void>;
  onSignOut: () => Promise<void>;
};

export function SpacesScreen(p: Props) {
  const screenContainer = useScreenContainer();
  const [createOpen, setCreateOpen] = useState(false);
  // A newly created space opens only after its sheet has finished sliding away.
  const created = useRef<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const spaces = useMemo(() => [...p.spaces].sort((a, b) => b.updatedAt - a.updatedAt), [p.spaces]);

  async function accept(id: string) {
    setAccepting(id);
    setRowError(null);
    try {
      await p.onAcceptInvitation(id);
    } catch (e) {
      setRowError({ id, message: errorText(e) });
    } finally {
      setAccepting(null);
    }
  }

  async function signOut() {
    setSigningOut(true);
    setRowError(null);
    try {
      await p.onSignOut();
    } catch (e) {
      setRowError({ id: 'signout', message: errorText(e) });
      setSigningOut(false);
    }
  }

  return (
    <div className="screen spaces">
      <header className="bar">
        <div className="wordmark">
          <BrandMark size={20} />
          <span>Common</span>
          {!p.isOnline && (
            <span className="offline-dot" title="Offline">
              <span className="sr-only">Offline</span>
            </span>
          )}
        </div>
        <div className="bar-actions">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="avatar-btn" aria-label="Account" title="Account">
                {signingOut ? <Spinner size={16} /> : <Avatar person={p.user} size={26} />}
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal container={screenContainer}>
              <DropdownMenu.Content className="menu" align="end" sideOffset={6}>
                <DropdownMenu.Label className="menu-label">
                  <span className="menu-name">{p.user.name}</span>
                  <span className="menu-email">{p.user.email}</span>
                </DropdownMenu.Label>
                <DropdownMenu.Separator className="menu-sep" />
                <DropdownMenu.Item className="menu-item" onSelect={() => setProfileOpen(true)}>
                  <PenLine size={14} aria-hidden="true" />
                  Edit profile
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" disabled={signingOut} onSelect={() => void signOut()}>
                  <LogOut size={14} aria-hidden="true" />
                  Sign out
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="menu-sep" />
                <DropdownMenu.Item className="menu-item menu-link" asChild>
                  <a href="/privacy" target="_blank" rel="noopener">
                    Privacy Policy
                  </a>
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item menu-link" asChild>
                  <a href="/terms" target="_blank" rel="noopener">
                    Terms of Service
                  </a>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      <div className="scroll">
        <div className="spaces-inner">
          {rowError?.id === 'signout' && (
            <p className="inline-error" role="alert">
              {rowError.message}
            </p>
          )}

          {p.pendingInvitations.length > 0 && (
            <section aria-labelledby="inv-h" className="section">
              <h2 id="inv-h" className="section-label">
                Invitations
              </h2>
              <ul className="list">
                {p.pendingInvitations.map((inv) => (
                  <motion.li key={inv.id} className="invite-row" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                    <div className="row-main">
                      <span className="row-title">{inv.spaceName}</span>
                      <span className="row-sub">from {inv.inviterName}</span>
                      {rowError?.id === inv.id && (
                        <span className="inline-error tight" role="alert">
                          {rowError.message}
                        </span>
                      )}
                    </div>
                    <button type="button" className="btn btn-primary btn-sm" disabled={accepting !== null} onClick={() => accept(inv.id)}>
                      {accepting === inv.id ? <Spinner size={12} /> : <Check size={13} aria-hidden="true" />}
                      Accept
                    </button>
                  </motion.li>
                ))}
              </ul>
            </section>
          )}

          {p.isLoading && spaces.length === 0 ? (
            <SpacesSkeleton />
          ) : spaces.length === 0 ? (
            <FirstSpace user={p.user} hasInvites={p.pendingInvitations.length > 0} onCreate={() => setCreateOpen(true)} />
          ) : (
            <section aria-labelledby="spaces-h" className="section">
              <h2 id="spaces-h" className="section-label">
                Spaces
              </h2>
              <ul className="list">
                {spaces.map((s, i) => (
                  <motion.li
                    key={s.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, delay: Math.min(i, 8) * 0.025, ease: [0.2, 0.7, 0.2, 1] }}
                  >
                    <button type="button" className="space-row" onClick={() => p.onSelectSpace(s.id)}>
                      <SpaceBadge symbol={s.symbol} name={s.name} color={s.color} imageUrl={s.imageUrl} size={36} />
                      <span className="row-main">
                        <span className="row-title">{s.name}</span>
                        <span className="row-sub">{s.lastMessage ? plainText(s.lastMessage) : ' '}</span>
                      </span>
                      <span className="row-side">
                        <span className="row-time">{shortStamp(s.updatedAt)}</span>
                        {s.unread > 0 ? (
                          <span className="unread" aria-label={`${s.unread} unread`}>
                            {s.unread > 99 ? '99+' : s.unread}
                          </span>
                        ) : (
                          <span className="row-count" aria-label={`${s.memberCount} members`}>
                            <Users size={11} aria-hidden="true" />
                            {s.memberCount}
                          </span>
                        )}
                      </span>
                    </button>
                  </motion.li>
                ))}
                <li>
                  <button type="button" className="space-row new-row" onClick={() => setCreateOpen(true)}>
                    <span className="new-badge" aria-hidden="true">
                      <Plus size={16} />
                    </span>
                    <span className="row-title">New space</span>
                  </button>
                </li>
              </ul>
            </section>
          )}
        </div>
      </div>

      <SpaceSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={async (input) => {
          created.current = await p.onCreateSpace(input);
        }}
        onExitComplete={() => {
          const id = created.current;
          created.current = null;
          if (id) p.onSelectSpace(id);
        }}
      />
      <ProfileSheet open={profileOpen} onOpenChange={setProfileOpen} user={p.user} onSave={p.onUpdateProfile} />
    </div>
  );
}

/** No spaces yet: the mark assembles, one clear action, and a note on where invitations appear. */
function FirstSpace({ user, hasInvites, onCreate }: { user: Person; hasInvites: boolean; onCreate: () => void }) {
  const first = user.name.trim().split(/\s+/)[0];
  const rise = (i: number) => ({
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, delay: 0.25 + i * 0.08, ease: [0.2, 0.7, 0.2, 1] as const },
  });
  return (
    <div className="first-space">
      <motion.span className="first-space-mark" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 20 }}>
        <AnimatedMark size={52} delay={0.15} strokeWidth={1.4} />
      </motion.span>
      <motion.h2 className="first-space-title" {...rise(0)}>
        {first ? `Welcome, ${first}` : 'Welcome to Common'}
      </motion.h2>
      <motion.p className="first-space-body" {...rise(1)}>
        {hasInvites
          ? 'Accept an invitation above, or start a space of your own for you, your people and your agents.'
          : 'Start a space for you, your people and your agents. You can invite people by email once it’s made.'}
      </motion.p>
      <motion.div {...rise(2)}>
        <button type="button" className="btn btn-primary btn-xl first-space-cta" onClick={onCreate}>
          <Plus size={18} aria-hidden="true" />
          Create your first space
        </button>
      </motion.div>
      {!hasInvites && (
        <motion.p className="first-space-note" {...rise(3)}>
          Waiting on an invite? It will show up here when someone invites <strong>{user.email}</strong>.
        </motion.p>
      )}
    </div>
  );
}

/** Placeholder rows while the spaces list loads, shaped like the real ones. */
function SpacesSkeleton() {
  return (
    <div className="section" aria-busy="true" aria-label="Loading spaces">
      <span className="skeleton skeleton-label" />
      {[0.72, 0.5, 0.62].map((w, i) => (
        <div key={i} className="skeleton-row" style={{ animationDelay: `${i * 0.12}s` }}>
          <span className="skeleton skeleton-badge" />
          <span className="skeleton-lines">
            <span className="skeleton" style={{ width: `${w * 60}%` }} />
            <span className="skeleton" style={{ width: `${w * 100}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}
