import { beforeEach, describe, expect, test } from 'vitest';

// A minimal in-memory localStorage for the test environment.
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

const { clearCache, readCachedSpaces, readCachedUser, writeCachedSpaces, writeCachedUser } = await import('../src/cache');
const me = { id: 'u1', name: 'Mayank', email: 'm@example.com', avatarSeed: 'u1', color: 0 };
const space = { id: 's1', name: 'The studio', symbol: '✳', color: 0, memberCount: 2, unread: 0, updatedAt: 1 };

describe('device cache', () => {
  beforeEach(() => store.clear());
  test('round-trips the profile and per-user spaces', () => {
    writeCachedUser(me);
    writeCachedSpaces('u1', [space]);
    expect(readCachedUser()).toEqual(me);
    expect(readCachedSpaces('u1')).toEqual([space]);
    expect(readCachedSpaces('someone-else')).toBeNull();
  });
  test('ignores corrupt or unexpected data instead of crashing', () => {
    store.set('common:me', '{not json');
    store.set('common:spaces:u1', JSON.stringify([{ id: 5 }]));
    expect(readCachedUser()).toBeNull();
    expect(readCachedSpaces('u1')).toBeNull();
  });
  test('sign-out clears remembered data but leaves unrelated keys', () => {
    writeCachedUser(me);
    writeCachedSpaces('u1', [space]);
    store.set('common:outbox:u1', '[]');
    clearCache();
    expect(readCachedUser()).toBeNull();
    expect(readCachedSpaces('u1')).toBeNull();
    expect(store.has('common:outbox:u1')).toBe(true);
  });
});
