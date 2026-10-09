// Soft, low-chroma tones. `bg`/`ink` pair for bubbles, `soft` for avatar and
// badge fills, `strong` for small accents (selection rings, unread dots).
export type Tone = { name: string; bg: string; ink: string; soft: string; strong: string };

export const TONES: Tone[] = [
  { name: 'Sky', bg: '#E8F0FA', ink: '#1E3A5A', soft: '#D5E4F5', strong: '#3B78C2' },
  { name: 'Rose', bg: '#FAEAEE', ink: '#5B1E2D', soft: '#F3D5DC', strong: '#C24D6B' },
  { name: 'Sage', bg: '#E7F1E9', ink: '#1D4429', soft: '#D1E5D7', strong: '#3F8A57' },
  { name: 'Amber', bg: '#FAF1DF', ink: '#57390B', soft: '#F2E0BB', strong: '#B9802A' },
  { name: 'Lavender', bg: '#EFEBFA', ink: '#36296A', soft: '#DDD6F5', strong: '#6D59C9' },
  { name: 'Teal', bg: '#E2F1F0', ink: '#12423F', soft: '#C8E5E3', strong: '#2C8984' },
  { name: 'Peach', bg: '#FBECE3', ink: '#5A2A14', soft: '#F5D6C5', strong: '#C8693F' },
  { name: 'Stone', bg: '#EFEEEA', ink: '#32302B', soft: '#DFDDD6', strong: '#6E6A60' },
];

export function tone(n: number): Tone {
  const i = Number.isFinite(n) ? Math.round(n) : 0;
  const len = TONES.length;
  return TONES[((i % len) + len) % len];
}

export const SYMBOLS = ['☕️', '🌿', '📚', '🎧', '🏠', '✈️', '🎨', '🌙', '⚽️', '🍜', '💼', '✨'];
