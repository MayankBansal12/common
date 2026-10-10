import { useState } from 'react';
import CommonUI from './ui/CommonUI';
import { emptyProps } from './App';
import type { Activity, Invitation, Message, Person, Space } from './types';

// In the preview, photos never leave the browser: undefined keeps, null removes, a Blob becomes an object URL.
const photo = (image: Blob | null | undefined, current?: string) => (image === undefined ? current : image ? URL.createObjectURL(image) : undefined);
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
  ['mayank', 'Let’s start with just us. A space, a few people, and a conversation. Notes are at getbb.app/docs', -10],
  ['dev', '> Keeping things simple\nThat’s enough to start something.', -8],
] as const;
export default function Preview() {
  const [user, setUser] = useState(people[0]);
  const [members, setMembers] = useState(people);
  const [spaces, setSpaces] = useState<Space[]>([{ id: 'studio', name: 'The studio', symbol: '✳', color: 0, memberCount: 3, unread: 0, updatedAt: now, lastMessage: 'That’s enough to start something.' }, { id: 'weekend', name: 'Weekend things', symbol: '☀', color: 3, memberCount: 1, unread: 0, updatedAt: now - 86_400_000 }]);
  const [selected, setSelected] = useState<string | null>(new URLSearchParams(location.search).get('screen') === 'spaces' ? null : 'studio');
  const [messageMap, setMessageMap] = useState<Record<string, Message[]>>({ studio: fixtures.map(([id, body, minutes], i) => ({ id: `example-${i}`, clientId: `example-${i}`, body, sender: people.find(p => p.id === id)!, createdAt: now + minutes * 60_000, status: 'sent' })) });
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [activities, setActivities] = useState<Activity[]>([{ id: 'created', actorName: 'Mayank', kind: 'space_created', createdAt: now - 86_400_000 }]);
  const [signedOut, setSignedOut] = useState(new URLSearchParams(location.search).get('screen') === 'login');
  const [emailStep, setEmailStep] = useState<'email' | 'code'>('email');
  const [emailAddress, setEmailAddress] = useState('');
  const space = spaces.find(s => s.id === selected) ?? null;
  const signIn = async () => { await wait(700); setSignedOut(false); setEmailStep('email'); };
  // Messages carry a snapshot of their sender; show the latest profile like the live app does.
  const messages = (selected ? messageMap[selected] ?? [] : []).map(m => ({ ...m, sender: members.find(p => p.id === m.sender.id) ?? m.sender }));
  return <CommonUI {...emptyProps} preview screen={signedOut ? 'login' : space ? 'chat' : 'spaces'} user={signedOut ? null : user} spaces={spaces} activeSpace={space} messages={messages} members={members} invitations={invitations} activities={activities}
    authAvailable={{ google: true, email: true }} emailStep={emailStep} emailAddress={emailAddress}
    onGoogleSignIn={signIn}
    onEmailSignIn={async email => { await wait(600); setEmailAddress(email); setEmailStep('code'); }}
    onVerifyCode={async code => { if (code !== '12345678') { await wait(500); throw new Error('That code didn’t work. In the preview, use 12345678.'); } await signIn(); }}
    onBackToEmail={() => setEmailStep('email')}
    onSignOut={async () => setSignedOut(true)} onSelectSpace={setSelected}
    onCreateSpace={async ({ name, symbol, color, image }) => { await wait(350); const id = crypto.randomUUID(); setSpaces(s => [{ id, name, symbol, color, imageUrl: photo(image), memberCount: 1, unread: 0, updatedAt: Date.now() }, ...s]); setMessageMap(m => ({ ...m, [id]: [] })); return id; }}
    onUpdateSpace={async ({ name, symbol, color, image }) => { await wait(350); setSpaces(s => s.map(x => x.id === selected ? { ...x, name, symbol, color, imageUrl: photo(image, x.imageUrl) } : x)); setActivities(a => [{ id: crypto.randomUUID(), actorName: user.name, kind: 'space_updated', createdAt: Date.now() }, ...a]); }}
    onSendMessage={async body => { if (!selected) return; const id = crypto.randomUUID(); setMessageMap(m => ({ ...m, [selected]: [...m[selected] ?? [], { id, clientId: id, body, sender: user, createdAt: Date.now(), status: 'sent' }] })); }}
    onInviteMember={async email => { const id = crypto.randomUUID(); setInvitations(i => [...i, { id, email, createdAt: Date.now() }]); setActivities(a => [{ id, actorName: user.name, kind: 'member_invited', subject: email, createdAt: Date.now() }, ...a]); }}
    onRevokeInvite={async id => setInvitations(i => i.filter(x => x.id !== id))}
    onRemoveMember={async id => setMembers(m => m.filter(x => x.id !== id))}
    onUpdateProfile={async ({ name, image, avatarSeed = user.avatarSeed }) => { await wait(350); const imageUrl = photo(image, user.imageUrl); setUser(u => ({ ...u, name, imageUrl, avatarSeed })); setMembers(m => m.map(p => p.id === user.id ? { ...p, name, imageUrl, avatarSeed } : p)); }}
  />;
}
