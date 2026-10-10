import type { Person, Space } from './types';

// Last-known data kept on this device so the app can open instantly after sign-in is confirmed.
// It is only ever shown, never used to drive backend requests, and live data replaces it as it arrives.
// Signing out clears it.
const ME = 'common:me';
const SPACES = 'common:spaces:';

function read<T>(key: string, valid: (value: unknown) => value is T): T | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: the app simply loads without the shortcut */
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isPerson = (v: unknown): v is Person => isRecord(v) && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.avatarSeed === 'string';
const isSpaces = (v: unknown): v is Space[] => Array.isArray(v) && v.every((s) => isRecord(s) && typeof s.id === 'string' && typeof s.name === 'string');

export const readCachedUser = () => read(ME, isPerson);
export const writeCachedUser = (user: Person) => write(ME, user);
export const readCachedSpaces = (userId: string) => read(SPACES + userId, isSpaces);
export const writeCachedSpaces = (userId: string, spaces: Space[]) => write(SPACES + userId, spaces);

export function clearCache() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => k !== null);
    for (const key of keys) if (key === ME || key.startsWith(SPACES)) localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}
