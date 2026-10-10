import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth, useConvexConnectionState, useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import type { CommonUIProps, Message, Person } from './types';
import CommonUI from './ui/CommonUI';
import { MESSAGE_LIMIT } from './ui/format';

function errorMessage(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === 'string') return error.data;
  return 'Something went wrong. Please try again.';
}

export class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main style={{ maxWidth: 360, margin: '25vh auto', fontFamily: 'system-ui', textAlign: 'center' }}><h2>Let’s reconnect.</h2><p>This space may no longer be available.</p><button onClick={() => { window.location.hash = ''; window.location.reload(); }}>Back to Common</button></main>;
    return this.props.children;
  }
}

type OutboxEntry = Message & { spaceId: string };
function readOutbox(userId: string): OutboxEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(`common:outbox:${userId}`) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x: OutboxEntry) => x.sender?.id === userId && typeof x.body === 'string' && typeof x.clientId === 'string' && typeof x.spaceId === 'string').map(x => ({ ...x, status: 'sending' }));
  } catch { return []; }
}

export default function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const user = useQuery(api.users.me, isAuthenticated ? {} : 'skip');
  const authOptions = useQuery(api.users.authOptions);
  const authActions = useAuthActions();
  const [emailAddress, setEmailAddress] = useState('');
  const [emailStep, setEmailStep] = useState<'email' | 'code'>('email');
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const performAuth = async (fn: () => Promise<unknown>) => {
    setError(null); setAuthBusy(true);
    try { await fn(); } catch { setError('Couldn’t sign in. Check your details and try again.'); } finally { setAuthBusy(false); }
  };
  const authProps = {
    emailStep, emailAddress, authBusy, authAvailable: authOptions ?? { google: false, email: false },
    onGoogleSignIn: () => performAuth(() => authActions.signIn('google', { redirectTo: '/' })),
    onEmailSignIn: (address: string) => performAuth(async () => {
      const normalized = address.trim().toLowerCase();
      await authActions.signIn('resend-otp', { email: normalized });
      setEmailAddress(normalized); setEmailStep('code');
    }),
    onVerifyCode: (code: string) => performAuth(() => authActions.signIn('resend-otp', { email: emailAddress, code: code.trim() })),
    onBackToEmail: () => { setEmailStep('email'); setError(null); },
    onSignOut: async () => { await authActions.signOut(); window.location.hash = ''; setEmailStep('email'); setEmailAddress(''); },
  };
  if (isAuthenticated && user) return <ConnectedApp key={user.id} user={user} authProps={authProps} />;
  return <CommonUI {...emptyProps} {...authProps} screen={isLoading || (isAuthenticated && user === undefined) ? 'loading' : 'login'} error={error} onDismissError={() => setError(null)} />;
}

const noop = async () => {};
export const emptyProps: CommonUIProps = {
  screen: 'loading', user: null, spaces: [], activeSpace: null, messages: [], members: [], invitations: [], pendingInvitations: [], activities: [], typing: [], isOnline: true, isLoadingMessages: false, hasMoreMessages: false, error: null,
  emailStep: 'email', emailAddress: '', authBusy: false, authAvailable: { google: false, email: false }, onGoogleSignIn: noop, onEmailSignIn: noop, onVerifyCode: noop, onBackToEmail() {}, onSignOut: noop, onCreateSpace: async () => '', onUpdateSpace: noop, onSelectSpace() {}, onSendMessage: noop, onTyping() {}, onRetryMessage() {}, onLoadMoreMessages() {}, onInviteMember: noop, onRemoveMember: noop, onRevokeInvite: noop, onAcceptInvitation: noop, onUpdateProfile: noop, onDismissError() {},
};
type AuthProps = Pick<CommonUIProps, 'emailStep' | 'emailAddress' | 'authBusy' | 'authAvailable' | 'onGoogleSignIn' | 'onEmailSignIn' | 'onVerifyCode' | 'onBackToEmail' | 'onSignOut'>;

function ConnectedApp({ user, authProps }: { user: Person; authProps: AuthProps }) {
  const spaceList = useQuery(api.spaces.list);
  const spaces = spaceList ?? [];
  const pendingInvitations = useQuery(api.members.pending) ?? [];
  const [selected, setSelected] = useState<string | null>(() => window.location.hash.startsWith('#space=') ? window.location.hash.slice(7) : null);
  const [error, setError] = useState<string | null>(null);
  const activeSpace = spaces.find(s => s.id === selected) ?? null;
  const spaceId = activeSpace?.id as Id<'spaces'> | undefined;
  const args = spaceId ? { spaceId } : 'skip';
  const members = useQuery(api.members.list, args) ?? [];
  const invitations = useQuery(api.members.invitations, args) ?? [];
  const activities = useQuery(api.members.activity, args) ?? [];
  const typing = useQuery(api.messages.typing, args) ?? [];
  const setTyping = useMutation(api.messages.setTyping);
  const paginated = usePaginatedQuery(api.messages.list, args, { initialNumItems: 50 });
  const connection = useConvexConnectionState();
  const isOnline = connection.isWebSocketConnected;
  const send = useMutation(api.messages.send);
  const create = useMutation(api.spaces.create);
  const updateSpace = useMutation(api.spaces.update);
  const generateUploadUrl = useMutation(api.users.generateUploadUrl);
  const markRead = useMutation(api.spaces.markRead);
  const invite = useMutation(api.members.invite);
  const remove = useMutation(api.members.remove);
  const revoke = useMutation(api.members.revoke);
  const accept = useMutation(api.members.accept);
  const updateProfile = useMutation(api.users.update);
  const [outbox, setOutbox] = useState<OutboxEntry[]>(() => readOutbox(user.id));
  const inflight = useRef(new Set<string>());
  useEffect(() => {
    try { localStorage.setItem(`common:outbox:${user.id}`, JSON.stringify(outbox)); } catch { /* In-memory queue remains usable when storage is unavailable. */ }
  }, [outbox, user.id]);
  useEffect(() => {
    const confirmed = new Set(paginated.results.map(m => m.clientId));
    if (outbox.some(m => confirmed.has(m.clientId))) setOutbox(current => current.filter(m => !confirmed.has(m.clientId)));
  }, [paginated.results, outbox]);
  useEffect(() => {
    if (!isOnline) return;
    for (const entry of outbox) {
      if (entry.status !== 'sending' || inflight.current.has(entry.clientId)) continue;
      inflight.current.add(entry.clientId);
      void send({ spaceId: entry.spaceId as Id<'spaces'>, clientId: entry.clientId, body: entry.body })
        .then(() => setOutbox(current => current.map(m => m.clientId === entry.clientId ? { ...m, status: 'sent' } : m)))
        .catch((e: unknown) => { setOutbox(current => current.map(m => m.clientId === entry.clientId ? { ...m, status: 'failed' } : m)); setError(errorMessage(e)); })
        .finally(() => inflight.current.delete(entry.clientId));
    }
  }, [outbox, isOnline, send]);
  const latestSequence = paginated.results[0]?.sequence;
  useEffect(() => {
    if (!spaceId || latestSequence === undefined) return;
    const read = () => { if (document.visibilityState === 'visible') void markRead({ spaceId, sequence: latestSequence }).catch(() => {}); };
    read(); document.addEventListener('visibilitychange', read);
    return () => document.removeEventListener('visibilitychange', read);
  }, [spaceId, latestSequence, markRead]);
  useEffect(() => {
    const update = () => setSelected(window.location.hash.startsWith('#space=') ? window.location.hash.slice(7) : null);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const select = useCallback((id: string | null) => { setSelected(id); window.location.hash = id ? `space=${id}` : ''; setError(null); }, []);
  // A Blob is uploaded to storage first; null (remove) and undefined (keep) pass straight through.
  const upload = async (image: Blob | null | undefined) => {
    if (!image) return image;
    const res = await fetch(await generateUploadUrl(), { method: 'POST', headers: { 'Content-Type': image.type }, body: image });
    if (!res.ok) throw new ConvexError('Couldn’t upload that photo. Please try again.');
    return ((await res.json()) as { storageId: Id<'_storage'> }).storageId;
  };
  const perform = async <T,>(fn: () => Promise<T>): Promise<T> => { setError(null); try { return await fn(); } catch (e) { const message = errorMessage(e); setError(message); throw new Error(message); } };
  const confirmedIds = new Set(paginated.results.map(m => m.clientId));
  const messages: Message[] = [...[...paginated.results].reverse(), ...outbox.filter(m => m.spaceId === spaceId && !confirmedIds.has(m.clientId))].sort((a, b) => a.createdAt - b.createdAt);
  return <CommonUI {...emptyProps} {...authProps}
    // Reopening a chat (#space=…) keeps the splash until that space has loaded, rather than flashing the list.
    screen={selected && spaceList === undefined ? 'loading' : activeSpace ? 'chat' : 'spaces'} isLoadingSpaces={spaceList === undefined} user={user} spaces={spaces} activeSpace={activeSpace} messages={messages} members={members} invitations={invitations} pendingInvitations={pendingInvitations} activities={activities} typing={typing}
    isOnline={isOnline} isLoadingMessages={paginated.status === 'LoadingFirstPage'} hasMoreMessages={paginated.status === 'CanLoadMore'} error={error} onDismissError={() => setError(null)}
    onSelectSpace={select}
    onCreateSpace={({ image, ...input }) => perform(async () => create({ ...input, imageId: await upload(image) }))}
    onUpdateSpace={async ({ image, ...input }) => { if (spaceId) await perform(async () => updateSpace({ ...input, spaceId, imageId: await upload(image) })); }}
    onTyping={(id, isTyping) => { void setTyping({ spaceId: id as Id<'spaces'>, typing: isTyping }).catch(() => {}); }}
    onSendMessage={async body => {
      const trimmed = body.trim();
      if (!spaceId || !trimmed) return;
      if (trimmed.length > MESSAGE_LIMIT) throw new Error('Messages must be under 2,000 characters.');
      const clientId = crypto.randomUUID();
      const sender = { ...user, color: members.find(m => m.id === user.id)?.color ?? user.color };
      setOutbox(current => [...current, { id: clientId, clientId, spaceId, body: trimmed, sender, createdAt: Date.now(), status: 'sending' }]);
    }}
    onRetryMessage={clientId => setOutbox(current => current.map(m => m.clientId === clientId ? { ...m, status: 'sending' } : m))}
    onLoadMoreMessages={() => { if (paginated.status === 'CanLoadMore') paginated.loadMore(50); }}
    onInviteMember={async email => { if (spaceId) await perform(() => invite({ spaceId, email })); }}
    onRemoveMember={async userId => { if (spaceId) await perform(() => remove({ spaceId, userId: userId as Id<'users'> })); }}
    onRevokeInvite={async id => { await perform(() => revoke({ invitationId: id as Id<'invitations'> })); }}
    onAcceptInvitation={async id => { const joined = await perform(() => accept({ invitationId: id as Id<'invitations'> })); select(joined); }}
    onUpdateProfile={async ({ image, ...input }) => { await perform(async () => updateProfile({ ...input, imageId: await upload(image) })); }}
  />;
}
