import { useEffect, useState } from 'react';
import CommonUI from './ui/CommonUI';
import { emptyProps } from './App';
import type { Activity, AgentConnection, AgentProps, ConsentProps, Invitation, Message, Person, Space, TypingPerson } from './types';

// In the preview, photos never leave the browser: undefined keeps, null removes, a Blob becomes an object URL.
const photo = (image: Blob | null | undefined, current?: string) => (image === undefined ? current : image ? URL.createObjectURL(image) : undefined);
// Mirrors the server: pending invitees appear as `an•••@gmail.com`.
const mask = (email: string) => { const at = email.lastIndexOf('@'); return at < 1 ? '•••' : `${email.slice(0, at > 2 ? 2 : 1)}•••${email.slice(at)}`; };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const people: Person[] = [
  { id: 'mayank', name: 'Mayank', email: 'mayank@example.com', avatarSeed: 'Mayank', color: 0, role: 'owner' },
  { id: 'tara', name: 'Tara', email: 'tara@example.com', avatarSeed: 'Tara', color: 2, role: 'member' },
  { id: 'dev', name: 'Dev', email: 'dev@example.com', avatarSeed: 'Dev', color: 4, role: 'member' },
];
const now = Date.now();
const fixtures = [
  ['tara', 'A small place for all our unfinished ideas.', -42],
  ['tara', 'Mood board is up → https://www.are.na/tara/common-ideas', -42],
  ['dev', 'And the occasional **good** one.', -41],
  ['mayank', 'I like it here already.', -40],
  ['mayank', '🙌', -40],
  ['tara', 'Made a little progress on the first version today. Keeping things *simple*:\n- spaces for your people\n- invites by email\n- `markdown` in messages', -12],
  ['dev', '## Notes from Saturday\nWe went through the first version together and agreed on what matters for now.\n\n**What stays**\n- Spaces stay small: a handful of people, not a crowd\n- Invites by email, nothing to install\n- Messages are short and *readable* on a phone\n\n**What changes**\n1. Onboarding gets shorter and friendlier\n2. Photos for people and spaces\n3. Markdown in messages, kept simple\n\n**Open questions**\n- How should agents introduce themselves when they join a space?\n- Do we want reactions, or is a reply enough?\n- What does a good empty space look like?\n\n> Keep it small, keep it calm.\n\nI’ll turn this into a checklist on the board tomorrow. Shout if I missed anything.', -11],
  ['mayank', 'Let’s start with just us. A space, a few people, and a conversation. Notes are at getbb.app/docs', -10],
  ['dev', '> Keeping things simple\nThat’s enough to start something.', -8],
] as const;
const screenParam = new URLSearchParams(location.search).get('screen');
export default function Preview() {
  const [user, setUser] = useState(people[0]);
  const [members, setMembers] = useState(people);
  // `&screen=loading` holds the loading screen; `&screen=slow` plays a slow start (sign-in check, then the
  // spaces list loading) so the splash and placeholders can be seen.
  const loadingView = new URLSearchParams(location.search).get('screen') === 'loading';
  const [slowPhase, setSlowPhase] = useState<'auth' | 'spaces' | 'ready'>(new URLSearchParams(location.search).get('screen') === 'slow' ? 'auth' : 'ready');
  useEffect(() => {
    if (slowPhase === 'ready') return;
    const t = setTimeout(() => setSlowPhase(slowPhase === 'auth' ? 'spaces' : 'ready'), slowPhase === 'auth' ? 900 : 1400);
    return () => clearTimeout(t);
  }, [slowPhase]);
  // `&screen=new` starts like a brand-new account: no spaces yet.
  const fresh = new URLSearchParams(location.search).get('screen') === 'new';
  const [spaces, setSpaces] = useState<Space[]>(fresh ? [] : [{ id: 'studio', name: 'The studio', symbol: '✳', color: 0, memberCount: 3, unread: 0, updatedAt: now, lastMessage: 'That’s enough to start something.' }, { id: 'weekend', name: 'Weekend things', symbol: '☀', color: 3, memberCount: 1, unread: 0, updatedAt: now - 86_400_000 }]);
  const [selected, setSelected] = useState<string | null>(['spaces', 'new', 'slow', 'agents', 'consent', 'consent-expired'].includes(new URLSearchParams(location.search).get('screen') ?? '') ? null : 'studio');
  const [messageMap, setMessageMap] = useState<Record<string, Message[]>>({ studio: [...fixtures.map(([id, body, minutes], i) => ({ id: `example-${i}`, clientId: `example-${i}`, body, sender: people.find(p => p.id === id)!, createdAt: now + minutes * 60_000, status: 'sent' as const })), ...agentFixtures] });
  const agents = usePreviewAgents();
  const consent = usePreviewConsent();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [activities, setActivities] = useState<Activity[]>([{ id: 'created', actorName: 'Mayank', kind: 'space_created', createdAt: now - 86_400_000 }]);
  const [signedOut, setSignedOut] = useState(new URLSearchParams(location.search).get('screen') === 'login');
  // The preview has no other people, so after you send, Tara "types" for a moment to show the indicator.
  const [typing, setTyping] = useState<TypingPerson[]>([]);
  const [emailStep, setEmailStep] = useState<'email' | 'code'>('email');
  const [emailAddress, setEmailAddress] = useState('');
  const space = spaces.find(s => s.id === selected) ?? null;
  const signIn = async () => { await wait(700); setSignedOut(false); setEmailStep('email'); };
  // Messages carry a snapshot of their sender; show the latest profile like the live app does.
  const messages = (selected ? messageMap[selected] ?? [] : []).map(m => ({ ...m, sender: members.find(p => p.id === m.sender.id) ?? m.sender }));
  return <>
  <p className="preview-label" role="note">Design preview · sample data, nothing is saved</p>
  <CommonUI {...emptyProps} agents={agents} consent={consent} openAgents={screenParam === 'agents'} screen={loadingView || slowPhase === 'auth' ? 'loading' : signedOut ? 'login' : space ? 'chat' : 'spaces'} user={signedOut ? null : user} spaces={slowPhase === 'ready' ? spaces : []} isLoadingSpaces={slowPhase === 'spaces'} activeSpace={space} messages={messages} members={members} invitations={invitations} activities={activities} typing={typing}
    authAvailable={{ google: true, email: true }} emailStep={emailStep} emailAddress={emailAddress}
    onGoogleSignIn={signIn}
    onEmailSignIn={async email => { await wait(600); setEmailAddress(email); setEmailStep('code'); }}
    onVerifyCode={async code => { if (code !== '123456') { await wait(500); throw new Error('That code didn’t work. In the preview, use 123456.'); } await signIn(); }}
    onBackToEmail={() => setEmailStep('email')}
    onSignOut={async () => setSignedOut(true)} onSelectSpace={setSelected}
    onCreateSpace={async ({ name, symbol, color, image }) => { await wait(350); const id = crypto.randomUUID(); setSpaces(s => [{ id, name, symbol, color, imageUrl: photo(image), memberCount: 1, unread: 0, updatedAt: Date.now() }, ...s]); setMessageMap(m => ({ ...m, [id]: [] })); return id; }}
    onUpdateSpace={async ({ name, symbol, color, image }) => { await wait(350); setSpaces(s => s.map(x => x.id === selected ? { ...x, name, symbol, color, imageUrl: photo(image, x.imageUrl) } : x)); setActivities(a => [{ id: crypto.randomUUID(), actorName: user.name, kind: 'space_updated', createdAt: Date.now() }, ...a]); }}
    onSendMessage={async body => { if (!selected) return; setTimeout(() => setTyping([{ ...people[1], expiresAt: Date.now() + 3500 }]), 700); setTimeout(() => setTyping([]), 4200); const id = crypto.randomUUID(); setMessageMap(m => ({ ...m, [selected]: [...m[selected] ?? [], { id, clientId: id, body, sender: user, createdAt: Date.now(), status: 'sent' }] })); }}
    onInviteMember={async email => { const id = crypto.randomUUID(); setInvitations(i => [...i, { id, email: mask(email), createdAt: Date.now(), canRevoke: true }]); setActivities(a => [{ id, actorName: user.name, kind: 'member_invited', subject: mask(email), createdAt: Date.now() }, ...a]); }}
    onRevokeInvite={async id => setInvitations(i => i.filter(x => x.id !== id))}
    onRemoveMember={async id => setMembers(m => m.filter(x => x.id !== id))}
    onUpdateProfile={async ({ name, image, avatarSeed = user.avatarSeed }) => { await wait(350); const imageUrl = photo(image, user.imageUrl); setUser(u => ({ ...u, name, imageUrl, avatarSeed })); setMembers(m => m.map(p => p.id === user.id ? { ...p, name, imageUrl, avatarSeed } : p)); }}
  />
  </>;
}

// Agents in the preview: Dev's agent posts in the thread; connections and consent are local mock-ups.
const agentFixtures: Message[] = [
  { id: 'agent-1', clientId: 'agent-1', body: 'Morning! I collected the notes from Saturday into a checklist on the board.', sender: people[2], agent: { id: 'claude', name: 'Claude' }, createdAt: now - 7 * 60_000, status: 'sent' },
  { id: 'agent-2', clientId: 'agent-2', body: 'Three items are still open. Want me to post a reminder on Friday?', sender: people[2], agent: { id: 'claude', name: 'Claude' }, createdAt: now - 7 * 60_000 + 20_000, status: 'sent' },
  // Your own agent: shown on the left as the agent, grouped apart from your own message just before it.
  { id: 'own-human', clientId: 'own-human', body: 'Can someone pull together this week’s open items?', sender: people[0], createdAt: now - 5 * 60_000, status: 'sent' },
  { id: 'own-agent', clientId: 'own-agent', body: 'On it. Three are open: onboarding copy, photo cropping and the empty-space screen.', sender: people[0], agent: { id: 'mayank-helper', name: 'Helper' }, createdAt: now - 5 * 60_000 + 15_000, status: 'sent' },
];
const sampleSpaces = [{ id: 'studio', name: 'The studio' }, { id: 'weekend', name: 'Weekend things' }];
function usePreviewAgents(): AgentProps {
  const [connections, setConnections] = useState<AgentConnection[] | undefined>(undefined);
  useEffect(() => {
    const t = setTimeout(() => setConnections([
      { id: 'c1', name: 'Coding agent', kind: 'oauth', clientName: 'Sample MCP client', redirectHost: '127.0.0.1:33418', scopes: ['messages:read', 'messages:send'], requestedScopes: ['messages:read', 'messages:send', 'spaces:manage', 'profile:write'], spaceMode: 'selected', spaces: [sampleSpaces[0]], createdAt: now - 3 * 86_400_000, lastUsedAt: now - 2 * 3_600_000, expired: false },
      // Created but never used: awaiting connection, not connected.
      { id: 'c2', name: 'Build bot', kind: 'token', scopes: ['messages:send'], requestedScopes: null, spaceMode: 'all', spaces: [], createdAt: now - 20 * 86_400_000, expiresAt: now + 70 * 86_400_000, expired: false },
      { id: 'c3', name: 'Old script', kind: 'token', scopes: ['messages:read'], requestedScopes: null, spaceMode: 'all', spaces: [], createdAt: now - 120 * 86_400_000, lastUsedAt: now - 95 * 86_400_000, expiresAt: now - 30 * 86_400_000, expired: true },
    ]), 700);
    return () => clearTimeout(t);
  }, []);
  return {
    connections,
    // `&mcp=none` shows the state for a build that doesn't know its server address.
    mcpUrl: new URLSearchParams(location.search).get('mcp') === 'none' ? null : 'https://your-deployment.convex.site/mcp',
    sampleNote: 'Preview: these connections are samples. Nothing here connects a real agent.',
    onUpdate: async (id, g) => { await wait(400); setConnections(cs => cs?.map(c => c.id === id ? { ...c, name: g.name, scopes: g.scopes, spaceMode: g.spaceMode, spaces: sampleSpaces.filter(s => g.spaceIds.includes(s.id)) } : c)); },
    onRevoke: async id => { await wait(400); setConnections(cs => cs?.filter(c => c.id !== id)); },
    onCreateToken: async g => { await wait(500); setConnections(cs => [{ id: crypto.randomUUID(), name: g.name, kind: 'token', scopes: g.scopes, requestedScopes: null, spaceMode: g.spaceMode, spaces: sampleSpaces.filter(s => g.spaceIds.includes(s.id)), createdAt: Date.now(), expiresAt: g.expiresInDays ? Date.now() + g.expiresInDays * 86_400_000 : undefined, expired: false }, ...(cs ?? [])]); return 'cmn_pat_PREVIEW-sample-token-not-valid-anywhere'; },
  };
}
/** `&screen=consent` shows the agent sign-in screen; `&screen=consent-expired` its expired state. */
function usePreviewConsent(): ConsentProps | undefined {
  const [open, setOpen] = useState(screenParam === 'consent' || screenParam === 'consent-expired');
  if (!open) return undefined;
  return {
    request: screenParam === 'consent-expired' ? { status: 'expired' } : { status: 'ready', clientName: 'Sample MCP client', redirectHost: '127.0.0.1:33418', requestedScopes: ['messages:read', 'messages:send', 'spaces:manage', 'profile:write'] },
    onApprove: async () => { await wait(600); setTimeout(() => setOpen(false), 1400); },
    onDeny: async () => { await wait(300); setTimeout(() => setOpen(false), 1400); },
    onDismiss: () => setOpen(false),
  };
}
