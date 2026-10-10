// Short by design: long enough for a real message or an agent prompt, short enough to stay conversational.
export const MESSAGE_LIMIT = 2000;

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const shortWeekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const DAY = 86_400_000;

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const dayKey = (ts: number) => startOfDay(ts);

export function timeOf(ts: number) {
  return timeFmt.format(ts);
}

export function dayLabel(ts: number) {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return weekdayFmt.format(ts);
  if (new Date(ts).getFullYear() === new Date().getFullYear()) return dateFmt.format(ts);
  return fullDateFmt.format(ts);
}

/** Compact stamp for lists: time today, weekday this week, date otherwise. */
export function shortStamp(ts: number) {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY);
  if (diff <= 0) return timeFmt.format(ts);
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return shortWeekdayFmt.format(ts);
  if (new Date(ts).getFullYear() === new Date().getFullYear()) return shortDateFmt.format(ts);
  return fullDateFmt.format(ts);
}

export function ago(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return shortDateFmt.format(ts);
}

export function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'data' in e && typeof (e as { data: unknown }).data === 'string') {
    return (e as { data: string }).data;
  }
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const uncaught = raw.match(/Uncaught (?:\w*Error):\s*([\s\S]*?)(?:\n|\s+at\s|$)/);
  const text = (uncaught ? uncaught[1] : raw).replace(/^\[CONVEX[^\]]*\]\s*/, '').trim();
  return text || 'Something went wrong. Try again.';
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
