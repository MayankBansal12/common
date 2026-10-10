import { useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { motion } from 'motion/react';
import { Check, LogOut, PenLine, Plus, Users } from 'lucide-react';
import type { PendingInvitation, Person, ProfileInput, Space, SpaceInput } from '../types';
import { Avatar, BrandMark, SpaceBadge, Spinner } from './primitives';
import { ProfileSheet, SpaceSheet } from './SpaceDialogs';
import { useScreenContainer } from './Device';
import { plainText } from './markdown';
import { errorText, shortStamp } from './format';

type Props = {
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
          <button type="button" className="icon-btn" aria-label="New space" title="New space" onClick={() => setCreateOpen(true)}>
            <Plus size={17} />
          </button>
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
                  <motion.li key={inv.id} className="invite-row" layout="position" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
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
