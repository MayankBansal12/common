import { describe, expect, test } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';

const modules = import.meta.glob('../convex/**/*.ts');
const paginationOpts = { numItems: 50, cursor: null };
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const owner = await ctx.db.insert('users', { name: 'Owner', email: 'owner@example.com', emailVerificationTime: Date.now() });
    const guest = await ctx.db.insert('users', { name: 'Guest', email: 'guest@example.com', emailVerificationTime: Date.now() });
    const stranger = await ctx.db.insert('users', { name: 'Stranger', email: 'stranger@example.com', emailVerificationTime: Date.now() });
    const unverified = await ctx.db.insert('users', { email: 'guest@example.com' });
    return { owner, guest, stranger, unverified };
  });
  const owner = t.withIdentity({ subject: ids.owner });
  const guest = t.withIdentity({ subject: ids.guest });
  const stranger = t.withIdentity({ subject: ids.stranger });
  const spaceId = await owner.mutation(api.spaces.create, { name: 'The studio', symbol: '✳', color: 0 });
  const join = async () => {
    const invitationId = await owner.mutation(api.members.invite, { spaceId, email: 'GUEST@example.com' });
    await guest.mutation(api.members.accept, { invitationId });
  };
  return { t, ids, owner, guest, stranger, spaceId, join };
}

describe('space access and invitations', () => {
  test('requires verified identity to create spaces', async () => {
    const { t, ids } = await setup();
    await expect(t.mutation(api.spaces.create, { name: 'No', symbol: '✳', color: 0 })).rejects.toThrow('sign in');
    await expect(t.withIdentity({ subject: ids.unverified }).mutation(api.spaces.create, { name: 'No', symbol: '✳', color: 0 })).rejects.toThrow('sign in');
  });
  test('creates an owner membership atomically and lists only joined spaces', async () => {
    const { owner, guest, spaceId } = await setup();
    expect((await owner.query(api.spaces.list))[0]).toMatchObject({ id: spaceId, memberCount: 1 });
    expect(await guest.query(api.spaces.list)).toEqual([]);
    expect((await owner.query(api.members.list, { spaceId }))[0].role).toBe('owner');
  });
  test('normalizes invitation email and only its verified recipient can accept', async () => {
    const { owner, guest, stranger, spaceId, t, ids } = await setup();
    const invitationId = await owner.mutation(api.members.invite, { spaceId, email: ' GUEST@Example.com ' });
    expect(await guest.query(api.members.pending)).toHaveLength(1);
    await expect(stranger.mutation(api.members.accept, { invitationId })).rejects.toThrow('unavailable');
    await expect(t.withIdentity({ subject: ids.unverified }).mutation(api.members.accept, { invitationId })).rejects.toThrow('sign in');
    await guest.mutation(api.members.accept, { invitationId });
    expect(await owner.query(api.members.list, { spaceId })).toHaveLength(2);
    expect(await guest.query(api.members.pending)).toEqual([]);
  });
  test('rejects expired and revoked invitations', async () => {
    const { owner, guest, spaceId, t } = await setup();
    const invitationId = await owner.mutation(api.members.invite, { spaceId, email: 'guest@example.com' });
    await t.run(ctx => ctx.db.patch(invitationId, { expiresAt: Date.now() - 1 }));
    await expect(guest.mutation(api.members.accept, { invitationId })).rejects.toThrow('unavailable');
    const freshId = await owner.mutation(api.members.invite, { spaceId, email: 'guest@example.com' });
    await owner.mutation(api.members.revoke, { invitationId: freshId });
    await expect(guest.mutation(api.members.accept, { invitationId: freshId })).rejects.toThrow('unavailable');
  });
  test('blocks outsiders from messages, members, pending invitations and activity', async () => {
    const { stranger, spaceId } = await setup();
    await expect(stranger.query(api.messages.list, { spaceId, paginationOpts })).rejects.toThrow('access');
    for (const fn of [api.members.list, api.members.invitations, api.members.activity]) await expect(stranger.query(fn, { spaceId })).rejects.toThrow('access');
    await expect(stranger.mutation(api.messages.send, { spaceId, clientId: 'outsider-message-001', body: 'Hello' })).rejects.toThrow('access');
  });
  test('only the owner removes members, with access revoked immediately', async () => {
    const { owner, guest, ids, spaceId, join } = await setup(); await join();
    await expect(guest.mutation(api.members.remove, { spaceId, userId: ids.owner })).rejects.toThrow('owner');
    await expect(owner.mutation(api.members.remove, { spaceId, userId: ids.owner })).rejects.toThrow('owner');
    await owner.mutation(api.members.remove, { spaceId, userId: ids.guest });
    await expect(guest.query(api.messages.list, { spaceId, paginationOpts })).rejects.toThrow('access');
    await expect(guest.mutation(api.messages.send, { spaceId, clientId: 'removed-user-msg-1', body: 'No' })).rejects.toThrow('access');
  });
});

describe('message reliability', () => {
  test('assigns distinct colors within small groups and keeps them on messages', async () => {
    const { owner, guest, spaceId, join } = await setup(); await join();
    const members = await owner.query(api.members.list, { spaceId });
    expect(new Set(members.map(m => m.color)).size).toBe(2);
    await guest.mutation(api.messages.send, { spaceId, body: 'My color', clientId: 'distinct-color-msg' });
    const result = await owner.query(api.messages.list, { spaceId, paginationOpts });
    expect(result.page[0].sender.color).toBe(members.find(m => m.role === 'member')!.color);
  });
  test('attributes messages to the session and deduplicates retries', async () => {
    const { owner, spaceId } = await setup();
    const args = { spaceId, body: 'Hello', clientId: 'message-retry-0001' };
    const first = await owner.mutation(api.messages.send, args);
    expect(await owner.mutation(api.messages.send, args)).toBe(first);
    const result = await owner.query(api.messages.list, { spaceId, paginationOpts });
    expect(result.page).toHaveLength(1);
    expect(result.page[0]).toMatchObject({ body: 'Hello', sender: { name: 'Owner' } });
  });
  test('prevents reusing message identifiers with different contents', async () => {
    const { owner, spaceId } = await setup();
    await owner.mutation(api.messages.send, { spaceId, body: 'Original', clientId: 'same-client-id-001' });
    await expect(owner.mutation(api.messages.send, { spaceId, body: 'Changed', clientId: 'same-client-id-001' })).rejects.toThrow('already used');
  });
  test('validates text and ids server-side', async () => {
    const { owner, spaceId } = await setup();
    for (const body of ['   ', 'a'.repeat(2001)]) await expect(owner.mutation(api.messages.send, { spaceId, body, clientId: 'validation-msg-001' })).rejects.toThrow('2,000');
    await expect(owner.mutation(api.messages.send, { spaceId, body: 'a'.repeat(2000), clientId: 'validation-msg-002' })).resolves.toBeTruthy();
    await expect(owner.mutation(api.messages.send, { spaceId, body: 'Hi', clientId: 'x' })).rejects.toThrow('identifier');
  });
  test('preserves message history, stable ordering, pagination and unread counts', async () => {
    const { owner, guest, spaceId, join } = await setup(); await join();
    for (let i = 0; i < 5; i++) await owner.mutation(api.messages.send, { spaceId, body: `Message ${i}`, clientId: `ordered-message-${i}` });
    const first = await guest.query(api.messages.list, { spaceId, paginationOpts: { numItems: 2, cursor: null } });
    expect(first.page.map(m => m.sequence)).toEqual([5, 4]);
    const second = await guest.query(api.messages.list, { spaceId, paginationOpts: { numItems: 2, cursor: first.continueCursor } });
    expect(second.page.map(m => m.sequence)).toEqual([3, 2]);
    expect((await guest.query(api.spaces.list))[0].unread).toBe(5);
    await guest.mutation(api.spaces.markRead, { spaceId, sequence: 5 });
    expect((await guest.query(api.spaces.list))[0].unread).toBe(0);
    await guest.mutation(api.spaces.markRead, { spaceId, sequence: 2 });
    expect((await guest.query(api.spaces.list))[0].unread).toBe(0);
  });
  test('throttles floods while permitting retries of accepted messages', async () => {
    const { owner, spaceId } = await setup();
    for (let i = 0; i < 30; i++) await owner.mutation(api.messages.send, { spaceId, body: 'Text', clientId: `rate-limited-msg-${i}` });
    await expect(owner.mutation(api.messages.send, { spaceId, body: 'Text', clientId: 'rate-limited-msg-30' })).rejects.toThrow('too fast');
    await expect(owner.mutation(api.messages.send, { spaceId, body: 'Text', clientId: 'rate-limited-msg-0' })).resolves.toBeTruthy();
  });
});

describe('space details and photos', () => {
  test('members edit a space and the change is recorded; outsiders cannot', async () => {
    const { guest, stranger, spaceId, join } = await setup(); await join();
    await guest.mutation(api.spaces.update, { spaceId, name: 'Studio B', symbol: '🎧', color: 3 });
    expect((await guest.query(api.spaces.list))[0]).toMatchObject({ name: 'Studio B', symbol: '🎧', color: 3 });
    expect((await guest.query(api.members.activity, { spaceId }))[0]).toMatchObject({ kind: 'space_updated', subject: 'Studio B', actorName: 'Guest' });
    await expect(stranger.mutation(api.spaces.update, { spaceId, name: 'Mine', symbol: '✳', color: 0 })).rejects.toThrow('access');
    await expect(guest.mutation(api.spaces.update, { spaceId, name: ' ', symbol: '✳', color: 0 })).rejects.toThrow('characters');
    await expect(guest.mutation(api.spaces.update, { spaceId, name: 'Ok', symbol: '✳', color: 9 })).rejects.toThrow('color');
  });
  test('accepts image uploads and avatar choices, keeps them unless changed, and rejects other files', async () => {
    const { t, owner, spaceId } = await setup();
    // convex-test omits the Content-Type that real uploads record, so set it as an upload would.
    const store = (blob: Blob) => t.run(async ctx => {
      const id = await ctx.storage.store(blob);
      await (ctx.db.patch as (id: unknown, value: object) => Promise<void>)(id, { contentType: blob.type });
      return id;
    });
    const image = await store(new Blob(['png'], { type: 'image/png' }));
    const text = await store(new Blob(['hello'], { type: 'text/plain' }));
    await owner.mutation(api.users.update, { name: 'Owner', imageId: image });
    expect((await owner.query(api.users.me))?.imageUrl).toBeTruthy();
    await owner.mutation(api.users.update, { name: 'Owner Renamed' });
    expect(await owner.query(api.users.me)).toMatchObject({ name: 'Owner Renamed', imageUrl: expect.any(String) });
    await owner.mutation(api.users.update, { name: 'Owner', imageId: null });
    expect((await owner.query(api.users.me))?.imageUrl).toBeUndefined();
    await expect(owner.mutation(api.users.update, { name: 'Owner', imageId: text })).rejects.toThrow('image');
    await owner.mutation(api.users.update, { name: 'Owner', avatarSeed: 'k3x9q2' });
    expect(await owner.query(api.users.me)).toMatchObject({ avatarSeed: 'k3x9q2' });
    await owner.mutation(api.users.update, { name: 'Owner Again' });
    expect(await owner.query(api.users.me)).toMatchObject({ name: 'Owner Again', avatarSeed: 'k3x9q2' });
    await expect(owner.mutation(api.users.update, { name: 'Owner', avatarSeed: ' ' })).rejects.toThrow('avatar');
    await owner.mutation(api.spaces.update, { spaceId, name: 'The studio', symbol: '✳', color: 0, imageId: image });
    expect((await owner.query(api.spaces.list))[0].imageUrl).toBeTruthy();
    const created = await owner.mutation(api.spaces.create, { name: 'Pics', symbol: '✳', color: 1, imageId: image });
    expect((await owner.query(api.spaces.list)).find(s => s.id === created)?.imageUrl).toBeTruthy();
    await expect(owner.mutation(api.spaces.create, { name: 'Nope', symbol: '✳', color: 1, imageId: text })).rejects.toThrow('image');
  });
});

describe('emails', () => {
  test('invitation emails escape user-provided names and keep subjects on one line', async () => {
    const { invitationEmail } = await import('../convex/lib/email');
    const mail = invitationEmail({ spaceName: '<b>Studio</b>\nBcc: x', inviterName: 'Tara & "co"', siteUrl: 'https://common.example' });
    expect(mail.subject).toBe('Tara & "co" invited you to <b>Studio</b> Bcc: x on Common');
    expect(mail.html).toContain('&lt;b&gt;Studio&lt;/b&gt;');
    expect(mail.html).toContain('Tara &amp; &quot;co&quot;');
    expect(mail.html).not.toContain('<b>Studio</b>');
    expect(mail.text).toContain('https://common.example');
  });
});
