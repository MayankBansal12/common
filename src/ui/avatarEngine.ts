// Loaded lazily: the notionists artwork is most of its weight.
// DiceBear "notionists" — a stand-in for Peerlist-style illustrated avatars.
import { createAvatar } from '@dicebear/core';
import { notionists } from '@dicebear/collection';
import { tone } from './palette';

const cache = new Map<string, string>();

export function avatarUri(seed: string, color: number) {
  const key = `${seed}\u0000${color}`;
  let uri = cache.get(key);
  if (!uri) {
    uri = createAvatar(notionists, {
      seed: seed || 'common',
      backgroundColor: [tone(color).soft.slice(1)],
      radius: 50,
      scale: 112,
      translateY: 4,
    }).toDataUri();
    cache.set(key, uri);
  }
  return uri;
}
