import { Fragment, type ReactNode } from 'react';

/*
 * Chat-sized Markdown: **bold**, *italic* / _italic_, ~~strike~~, `code`, ```code blocks```,
 * # headings, > quotes, - lists, 1. lists, [label](url) and bare links. Everything renders to React
 * elements (never HTML strings), and only http(s) and mailto links are ever produced.
 */

type Inline =
  | { t: 'text'; v: string }
  | { t: 'esc'; v: string }
  | { t: 'code'; v: string }
  | { t: 'b' | 'i' | 's'; m: string; c: Inline[] }
  | { t: 'link'; href: string; label: Inline[]; url: string }
  | { t: 'auto'; href: string; v: string };

/* ───────── Links ───────── */

const TLDS =
  'com|org|net|io|dev|app|ai|co|me|so|gg|xyz|edu|gov|info|tech|link|page|sh|fm|tv|ly|to|us|uk|in|de|fr|es|it|nl|ca|au|jp|br|ch|se|no|fi|dk|be|at|ie|nz|sg|hk|kr|cn|ru|eu|cc|site|online|store|blog|news|design|studio|art|club|live|world|life|social|email|chat|cloud|run|build';
// Order matters: explicit schemes and www first, then email (so `a@b.com` isn't half a domain), then bare domains.
const LINK_RE = new RegExp(
  [
    String.raw`(?:https?:\/\/|www\.)[^\s<>"]+`,
    String.raw`[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}(?![a-z0-9-])`,
    String.raw`(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:${TLDS})(?![a-z0-9-])(?::\d{2,5})?(?:[/?#][^\s<>"]*)?`,
  ].join('|'),
  'iy',
);
const TRAILING = /[.,:;!?'"»…*_~]+$/;

/** Trims sentence punctuation and unbalanced closing brackets off the end of a detected link. */
function trimLink(raw: string) {
  let s = raw;
  for (;;) {
    const before = s;
    s = s.replace(TRAILING, '');
    for (const [open, close] of [
      ['(', ')'],
      ['[', ']'],
    ]) {
      while (s.endsWith(close) && s.split(close).length > s.split(open).length) s = s.slice(0, -1);
    }
    if (s === before) return s;
  }
}

export function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (/^mailto:[^\s]+@/i.test(url)) return url;
  if (/^www\./i.test(url)) return `https://${url}`;
  if (/^[^\s/@]+@[^\s@]+\.[a-z]{2,}$/i.test(url)) return `mailto:${url}`;
  LINK_RE.lastIndex = 0;
  const m = LINK_RE.exec(url);
  if (m && m[0].length === url.length && !url.includes('@')) return `https://${url}`;
  return null;
}

function linkAt(s: string, i: number): { v: string; href: string } | null {
  // A link starts a word: not glued to letters, an address, a path or a file name.
  if (i > 0 && /[\w@./\-:]/.test(s[i - 1])) return null;
  LINK_RE.lastIndex = i;
  const m = LINK_RE.exec(s);
  if (!m) return null;
  const v = trimLink(m[0]);
  if (!v || /^(https?:\/\/|www\.)$/i.test(v)) return null;
  const href = v.includes('@') && !/^https?:|^www\./i.test(v) ? `mailto:${v}` : /^https?:\/\//i.test(v) ? v : `https://${v}`;
  return { v, href };
}

/** The first link in `text`, for highlighting links as they're typed. */
export function findLink(text: string): { index: number; text: string; href: string } | null {
  for (let i = 0; i < text.length; i++) {
    if (!/[a-z0-9]/i.test(text[i])) continue;
    const link = linkAt(text, i);
    if (link) return { index: i, text: link.v, href: link.href };
  }
  return null;
}

/* ───────── Inline parsing ───────── */

const ESCAPABLE = /[\\`*_~[\]()>#\-.!|]/;
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

function findClose(s: string, from: number, m: string): number {
  for (let j = from; j <= s.length - m.length; j++) {
    if (s[j] === '\\') {
      j++;
      continue;
    }
    if (s[j] === '`') {
      const end = s.indexOf('`', j + 1);
      if (end > 0) j = end;
      continue;
    }
    if (!s.startsWith(m, j) || isSpace(s[j - 1])) continue;
    if (m === '*' && (s[j + 1] === '*' || s[j - 1] === '*')) continue;
    // Single markers only close at a word boundary, so `2*3*4` and snake_case stay literal.
    if ((m === '_' || m === '*') && isWord(s[j + 1])) continue;
    return j;
  }
  return -1;
}

function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];

    if (ch === '\\' && ESCAPABLE.test(s[i + 1] ?? '')) {
      flush();
      out.push({ t: 'esc', v: s[i + 1] });
      i += 2;
      continue;
    }

    if (ch === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'code', v: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (ch === '[') {
      const close = s.indexOf('](', i + 1);
      const end = close > i ? s.indexOf(')', close + 2) : -1;
      if (close > i + 1 && end > close + 2 && !s.slice(i + 1, close).includes('[')) {
        const url = s.slice(close + 2, end);
        const href = safeHref(url);
        if (href) {
          flush();
          out.push({ t: 'link', href, url, label: parseInline(s.slice(i + 1, close)) });
          i = end + 1;
          continue;
        }
      }
    }

    const pair = s.startsWith('**', i) ? '**' : s.startsWith('~~', i) ? '~~' : null;
    if (pair && !isSpace(s[i + 2])) {
      const end = findClose(s, i + 3, pair);
      if (end > 0) {
        flush();
        out.push({ t: pair === '**' ? 'b' : 's', m: pair, c: parseInline(s.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if ((ch === '*' || ch === '_') && !isSpace(s[i + 1]) && s[i + 1] !== ch && !isWord(s[i - 1])) {
      const end = findClose(s, i + 2, ch);
      if (end > 0) {
        flush();
        out.push({ t: 'i', m: ch, c: parseInline(s.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    const link = /[a-z0-9]/i.test(ch) ? linkAt(s, i) : null;
    if (link) {
      flush();
      out.push({ t: 'auto', href: link.href, v: link.v });
      i += link.v.length;
      continue;
    }

    text += ch;
    i++;
  }
  flush();
  return out;
}

/* ───────── Blocks ───────── */

type Block =
  | { t: 'p'; lines: string[] }
  | { t: 'h'; level: number; body: string }
  | { t: 'quote'; lines: { mark: string; body: string }[] }
  | { t: 'ul' | 'ol'; items: { mark: string; body: string; n: number }[] }
  | { t: 'code'; open: string; lines: string[]; close: string | null }
  | { t: 'blank'; raw: string };

const FENCE = /^\s*```/;
// A heading needs a space after the hashes, so `#letsgo` stays a plain hashtag.
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const QUOTE = /^(\s*>\s?)(.*)$/;
const UL = /^(\s*[-*•]\s+)(.*)$/;
const OL = /^(\s*(\d{1,3})[.)]\s+)(.*)$/;

function parseBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const last = blocks[blocks.length - 1];
    if (FENCE.test(line)) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !FENCE.test(lines[j])) body.push(lines[j++]);
      blocks.push({ t: 'code', open: line, lines: body, close: j < lines.length ? lines[j] : null });
      i = j;
      continue;
    }
    if (!line.trim()) {
      blocks.push({ t: 'blank', raw: line });
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(HEADING))) {
      blocks.push({ t: 'h', level: m[1].length, body: m[2].replace(/\s+#+\s*$/, '') });
    } else if ((m = line.match(QUOTE))) {
      if (last?.t === 'quote') last.lines.push({ mark: m[1], body: m[2] });
      else blocks.push({ t: 'quote', lines: [{ mark: m[1], body: m[2] }] });
    } else if ((m = line.match(UL))) {
      if (last?.t === 'ul') last.items.push({ mark: m[1], body: m[2], n: 0 });
      else blocks.push({ t: 'ul', items: [{ mark: m[1], body: m[2], n: 0 }] });
    } else if ((m = line.match(OL))) {
      if (last?.t === 'ol') last.items.push({ mark: m[1], body: m[3], n: Number(m[2]) });
      else blocks.push({ t: 'ol', items: [{ mark: m[1], body: m[3], n: Number(m[2]) }] });
    } else if (last?.t === 'p') last.lines.push(line);
    else blocks.push({ t: 'p', lines: [line] });
  }
  return blocks;
}

/* ───────── Message view ───────── */

function inlineNodes(nodes: Inline[], key = ''): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.t) {
      case 'text':
      case 'esc':
        return <Fragment key={k}>{n.v}</Fragment>;
      case 'code':
        return (
          <code key={k} className="md-code">
            {n.v}
          </code>
        );
      case 'b':
        return <strong key={k}>{inlineNodes(n.c, k)}</strong>;
      case 'i':
        return <em key={k}>{inlineNodes(n.c, k)}</em>;
      case 's':
        return <s key={k}>{inlineNodes(n.c, k)}</s>;
      case 'link':
      case 'auto':
        return (
          <a key={k} href={n.href} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}>
            {n.t === 'link' ? inlineNodes(n.label, k) : n.v}
          </a>
        );
    }
  });
}

const lineNodes = (lines: string[], key: string) =>
  lines.map((l, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {inlineNodes(parseInline(l), `${key}-${i}-`)}
    </Fragment>
  ));

export function renderMessage(text: string): ReactNode {
  const blocks = parseBlocks(text.trim());
  const out: ReactNode[] = [];
  blocks.forEach((b, i) => {
    switch (b.t) {
      case 'blank':
        return;
      case 'p':
        out.push(
          <p key={i} className="md-p">
            {lineNodes(b.lines, `p${i}`)}
          </p>,
        );
        return;
      case 'h': {
        // Chat-sized: headings from agents and pasted notes shouldn't shout.
        const Tag = `h${Math.min(b.level + 2, 6)}` as 'h3' | 'h4' | 'h5' | 'h6';
        out.push(
          <Tag key={i} className={`md-h md-h${Math.min(b.level, 4)}`}>
            {inlineNodes(parseInline(b.body), `h${i}-`)}
          </Tag>,
        );
        return;
      }
      case 'quote':
        out.push(
          <blockquote key={i} className="md-quote">
            {lineNodes(
              b.lines.map((l) => l.body),
              `q${i}`,
            )}
          </blockquote>,
        );
        return;
      case 'ul':
        out.push(
          <ul key={i} className="md-list">
            {b.items.map((it, j) => (
              <li key={j}>{inlineNodes(parseInline(it.body), `u${i}-${j}-`)}</li>
            ))}
          </ul>,
        );
        return;
      case 'ol':
        out.push(
          <ol key={i} className="md-list" start={b.items[0].n}>
            {b.items.map((it, j) => (
              <li key={j}>{inlineNodes(parseInline(it.body), `o${i}-${j}-`)}</li>
            ))}
          </ol>,
        );
        return;
      case 'code':
        out.push(
          <pre key={i} className="md-pre">
            <code>{b.lines.join('\n')}</code>
          </pre>,
        );
        return;
    }
  });
  return out;
}

/** Text for previews (space list, notifications): markers removed, links kept as written. */
export function plainText(text: string): string {
  const flat = (nodes: Inline[]): string =>
    nodes.map((n) => (n.t === 'text' || n.t === 'esc' || n.t === 'code' || n.t === 'auto' ? n.v : n.t === 'link' ? flat(n.label) : flat(n.c))).join('');
  return parseBlocks(text)
    .flatMap((b) =>
      b.t === 'p'
        ? b.lines
        : b.t === 'h'
          ? [b.body]
        : b.t === 'quote'
          ? b.lines.map((l) => l.body)
          : b.t === 'ul' || b.t === 'ol'
            ? b.items.map((it) => it.body)
            : b.t === 'code'
              ? b.lines
              : [],
    )
    .map((l) => flat(parseInline(l)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ───────── Emoji-only messages ───────── */

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*|\p{Regional_Indicator}{2})(?:\s*(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*|\p{Regional_Indicator}{2})){0,2}$/u;

/** One to three emoji and nothing else: shown large, without a bubble, like iMessage. */
export const isJumboEmoji = (text: string) => EMOJI_ONLY.test(text.trim());
