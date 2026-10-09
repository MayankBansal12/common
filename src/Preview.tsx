import { useState } from 'react';
import CommonUI from './ui/CommonUI';
import { emptyProps } from './App';
import type { Activity, Invitation, Message, Person, Space } from './types';

const people: Person[] = [
  { id: 'mayank', name: 'Mayank', email: 'mayank@example.com', avatarSeed: 'Mayank', color: 0, role: 'owner' },
  { id: 'tara', name: 'Tara', email: 'tara@example.com', avatarSeed: 'Tara', color: 2, role: 'member' },
  { id: 'dev', name: 'Dev', email: 'dev@example.com', avatarSeed: 'Dev', color: 4, role: 'member' },
];
const now = Date.now();
const fixtures = [
  ['tara', 'A small place for all our unfinished ideas.', -26],
  ['dev', 'And the occasional good one.', -25],
  ['mayank', 'I like it here already.', -24],
  ['tara', 'Made a little progress on the first version today. Keeping things simple.', -12],
  ['mayank', 'Let’s start with just us. A space, a few people, and a conversation.', -10],
  ['dev', 'That’s enough to start something.', -8],
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
  const space = spaces.find(s => s.id === selected) ?? null;
  return <CommonUI {...emptyProps} preview screen={signedOut ? 'login' : space ? 'chat' : 'spaces'} user={signedOut ? null : user} spaces={spaces} activeSpace={space} messages={selected ? messageMap[selected] ?? [] : []} members={members} invitations={invitations} activities={activities}
    onSignOut={async () => setSignedOut(true)} onSelectSpace={setSelected}
    onCreateSpace={async (name, symbol, color) => { const id = crypto.randomUUID(); setSpaces(s => [...s, { id, name, symbol, color, memberCount: 1, unread: 0, updatedAt: Date.now() }]); setSelected(id); }}
    onSendMessage={async body => { if (!selected) return; const id = crypto.randomUUID(); setMessageMap(m => ({ ...m, [selected]: [...m[selected] ?? [], { id, clientId: id, body, sender: user, createdAt: Date.now(), status: 'sent' }] })); }}
    onInviteMember={async email => { const id = crypto.randomUUID(); setInvitations(i => [...i, { id, email, createdAt: Date.now() }]); setActivities(a => [{ id, actorName: user.name, kind: 'member_invited', subject: email, createdAt: Date.now() }, ...a]); }}
    onRevokeInvite={async id => setInvitations(i => i.filter(x => x.id !== id))}
    onRemoveMember={async id => setMembers(m => m.filter(x => x.id !== id))}
    onUpdateProfile={async name => { setUser(u => ({ ...u, name })); setMembers(m => m.map(p => p.id === user.id ? { ...p, name } : p)); }}
  />;
}
