import { useEffect, useState } from 'react';
import CommonUI from './ui/CommonUI';
import { emptyProps } from './App';
import type { Activity, Invitation, Message, Person, Space, TypingPerson } from './types';

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
  const [selected, setSelected] = useState<string | null>(['spaces', 'new', 'slow'].includes(new URLSearchParams(location.search).get('screen') ?? '') ? null : 'studio');
  const [messageMap, setMessageMap] = useState<Record<string, Message[]>>({ studio: fixtures.map(([id, body, minutes], i) => ({ id: `example-${i}`, clientId: `example-${i}`, body, sender: people.find(p => p.id === id)!, createdAt: now + minutes * 60_000, status: 'sent' })) });
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
  return <CommonUI {...emptyProps} screen={loadingView || slowPhase === 'auth' ? 'loading' : signedOut ? 'login' : space ? 'chat' : 'spaces'} user={signedOut ? null : user} spaces={slowPhase === 'ready' ? spaces : []} isLoadingSpaces={slowPhase === 'spaces'} activeSpace={space} messages={messages} members={members} invitations={invitations} activities={activities} typing={typing}
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
  />;
}
