import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowUp, ChevronLeft, RotateCw } from 'lucide-react';
import type { Activity, Invitation, Message, Person, Space } from '../types';
import { Avatar, SpaceBadge, Spinner } from './primitives';
import { MembersDialog } from './MembersDialog';
import { tone } from './palette';
import { dayKey, dayLabel, timeOf } from './format';
import { readSession, usePrefersFinePointer, writeSession } from './hooks';

type Props = {
  user: Person;
  space: Space;
  messages: Message[];
  members: Person[];
  invitations: Invitation[];
  activities: Activity[];
  isOnline: boolean;
  isLoadingMessages: boolean;
  hasMoreMessages: boolean;
  onBack: () => void;
  onSendMessage: (body: string) => Promise<void>;
  onRetryMessage: (clientId: string) => void;
  onLoadMoreMessages: () => void;
  onInviteMember: (email: string) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onRevokeInvite: (id: string) => Promise<void>;
};

const keyOf = (m: Message) => m.clientId || m.id;
const NEAR_BOTTOM = 48;

export function ChatScreen(p: Props) {
  const { user, space, messages } = p;
  const reduce = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [unseen, setUnseen] = useState(0);

  const atBottom = useRef(true);
  const lastHeight = useRef(0);
  const stickNext = useRef(false);
  const edges = useRef<{ space: string; first?: string; last?: string; count: number }>({ space: '', count: 0 });
  const known = useRef(new Set<string>());
  const latest = useRef(messages);
  latest.current = messages;

  // Messages appended after the previous tail animate in; initial and prepended history do not.
  const ready = edges.current.space === space.id && edges.current.count > 0;
  const prevTailIdx = ready && edges.current.last ? messages.findIndex((m) => keyOf(m) === edges.current.last) : -1;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const e = edges.current;
    const first = messages[0] ? keyOf(messages[0]) : undefined;
    const last = messages.length ? keyOf(messages[messages.length - 1]) : undefined;

    if (e.space !== space.id || e.count === 0) {
      if (e.space !== space.id) known.current = new Set();
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
      setUnseen(0);
      setShowJump(false);
    } else {
      if (first !== e.first && last === e.last) {
        // Older history prepended: keep the reader anchored on what they were looking at.
        el.scrollTop += el.scrollHeight - lastHeight.current;
      } else if (last !== e.last) {
        const tail = messages[messages.length - 1];
        if (atBottom.current || stickNext.current || tail?.sender.id === user.id) {
          el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
          atBottom.current = true;
          stickNext.current = false;
        } else {
          const prevIdx = e.last ? messages.findIndex((m) => keyOf(m) === e.last) : -1;
          setUnseen((u) => u + (prevIdx >= 0 ? messages.length - 1 - prevIdx : 1));
        }
      }
    }
    edges.current = { space: space.id, first, last, count: messages.length };
    lastHeight.current = el.scrollHeight;
    for (const m of messages) known.current.add(keyOf(m));
  }, [messages, space.id, user.id, reduce]);

  // Keep pinned to the bottom when the viewport resizes (composer growth, mobile keyboard).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
      lastHeight.current = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = distance < NEAR_BOTTOM;
    lastHeight.current = el.scrollHeight;
    setScrolled(el.scrollTop > 4);
    setShowJump(distance > 240);
    if (atBottom.current) setUnseen(0);
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
    atBottom.current = true;
    setUnseen(0);
  }

  const others = p.members.filter((m) => m.id !== user.id);
  const stack = (others.length ? others : p.members).slice(0, 3);

  let prevDay = -1;

  return (
    <div className="screen chat">
      <header className="chat-head" data-scrolled={scrolled || undefined}>
        <button type="button" className="icon-btn" aria-label="Back to spaces" title="Back to spaces" onClick={p.onBack}>
          <ChevronLeft size={19} />
        </button>
        <button type="button" className="chat-title" onClick={() => setMembersOpen(true)} aria-label={`${space.name} details`}>
          <SpaceBadge symbol={space.symbol} name={space.name} color={space.color} size={34} />
          <span className="chat-name">
            <span className="chat-name-text">{space.name}</span>
          </span>
          {!p.isOnline && (
            <span className="chat-status">
              <span className="offline-dot" aria-hidden="true" />
              Offline
            </span>
          )}
        </button>
        <button
          type="button"
          className="member-stack"
          onClick={() => setMembersOpen(true)}
          aria-label={`Members (${p.members.length})`}
          title="Members"
        >
          {stack.map((m) => (
            <Avatar key={m.id} person={m} size={24} className="stacked" />
          ))}
          {p.members.length > 3 && <span className="stack-more">+{p.members.length - 3}</span>}
        </button>
      </header>

      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-inner">
          {(p.hasMoreMessages || (p.isLoadingMessages && messages.length > 0)) && (
            <div className="load-older">
              <button type="button" className="pill-btn" disabled={p.isLoadingMessages} onClick={p.onLoadMoreMessages}>
                {p.isLoadingMessages ? <Spinner size={12} /> : <ArrowUp size={12} aria-hidden="true" />}
                Earlier messages
              </button>
            </div>
          )}
          {p.isLoadingMessages && messages.length === 0 && (
            <div className="chat-loading" aria-label="Loading messages">
              <Spinner size={16} />
            </div>
          )}
          <ol className="messages" role="log" aria-label={`Messages in ${space.name}`}>
            {messages.map((m, i) => {
              const day = dayKey(m.createdAt);
              const divider = day !== prevDay;
              prevDay = day;
              const k = keyOf(m);
              const animate = ready && !known.current.has(k) && i > prevTailIdx;
              return (
                <Fragment key={k}>
                  {divider && (
                    <li className="day">
                      <span>{dayLabel(m.createdAt)}</span>
                    </li>
                  )}
                  <MessageRow m={m} mine={m.sender.id === user.id} animate={animate} onRetry={p.onRetryMessage} />
                </Fragment>
              );
            })}
          </ol>
        </div>
      </div>

      <AnimatePresence>
        {showJump && (
          <motion.button
            type="button"
            className="jump"
            onClick={jumpToLatest}
            aria-label={unseen ? `${unseen} new messages, jump to latest` : 'Jump to latest'}
            title="Jump to latest"
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 520, damping: 32 }}
          >
            <ArrowDown size={14} aria-hidden="true" />
            {unseen > 0 && <span className="jump-count">{unseen > 99 ? '99+' : unseen}</span>}
          </motion.button>
        )}
      </AnimatePresence>

      <Composer
        key={`${user.id}:${space.id}`}
        draftKey={`common:draft:${user.id}:${space.id}`}
        spaceName={space.name}
        onSend={(body) => {
          stickNext.current = true;
          return p.onSendMessage(body);
        }}
        isQueued={(body) => latest.current.some((m) => m.sender.id === user.id && m.body === body && m.status !== 'sent')}
      />

      <MembersDialog
        open={membersOpen}
        onOpenChange={setMembersOpen}
        space={space}
        user={user}
        members={p.members}
        invitations={p.invitations}
        activities={p.activities}
        onInvite={p.onInviteMember}
        onRemove={p.onRemoveMember}
        onRevoke={p.onRevokeInvite}
      />
    </div>
  );
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;
function linkify(text: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

const MessageRow = memo(function MessageRow({ m, mine, animate, onRetry }: { m: Message; mine: boolean; animate: boolean; onRetry: (clientId: string) => void }) {
  const t = tone(m.sender.color);
  const status = m.status ?? 'sent';
  const stamp =
    status === 'sending' ? (
      <span className="meta-time">Sending…</span>
    ) : status === 'failed' ? (
      <span className="meta-failed">
        Not sent
        <button type="button" className="retry" onClick={() => onRetry(m.clientId)} aria-label="Retry sending message" title="Retry">
          <RotateCw size={11} aria-hidden="true" />
          Retry
        </button>
      </span>
    ) : (
      <time className="meta-time" dateTime={new Date(m.createdAt).toISOString()}>
        {timeOf(m.createdAt)}
      </time>
    );
  const who = (
    <span className="meta-who">
      <Avatar person={m.sender} size={16} />
      <span className="meta-name">{mine ? 'You' : m.sender.name}</span>
    </span>
  );
  return (
    <motion.li
      className={`msg ${mine ? 'mine' : 'theirs'}`}
      data-status={status}
      initial={animate ? { opacity: 0, y: 12, scale: 0.94 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 560, damping: 34, mass: 0.7 }}
      style={{ transformOrigin: mine ? '100% 100%' : '0% 100%' } as CSSProperties}
    >
      <div className="msg-stack">
        <div className="bubble" style={{ '--b-bg': t.bg, '--b-ink': t.ink } as CSSProperties}>
          {linkify(m.body)}
        </div>
        <div className="meta">
          {mine ? (
            <>
              {stamp}
              {who}
            </>
          ) : (
            <>
              {who}
              {stamp}
            </>
          )}
        </div>
      </div>
    </motion.li>
  );
});

function Composer({
  draftKey: storageKey,
  spaceName,
  onSend,
  isQueued,
}: {
  draftKey: string;
  spaceName: string;
  onSend: (body: string) => Promise<void>;
  isQueued: (body: string) => boolean;
}) {
  const [value, setValue] = useState(() => readSession(storageKey));
  const ref = useRef<HTMLTextAreaElement>(null);
  const fine = usePrefersFinePointer();

  useEffect(() => {
    writeSession(storageKey, value);
  }, [storageKey, value]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [value]);

  useEffect(() => {
    if (fine) ref.current?.focus({ preventScroll: true });
  }, [fine]);

  const canSend = value.trim().length > 0;

  function send() {
    const body = value.trim();
    if (!body) return;
    setValue('');
    writeSession(storageKey, '');
    // The parent owns the durable queue; queued failures surface as a retryable bubble.
    // If the send never made it into the queue, hand the text back instead of losing it.
    const restore = () => {
      if (isQueued(body)) return;
      setValue((v) => (v ? v : body));
      writeSession(storageKey, readSession(storageKey) || body);
    };
    try {
      onSend(body).catch(restore);
    } catch {
      restore();
    }
    ref.current?.focus({ preventScroll: true });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && fine) {
      e.preventDefault();
      send();
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className="capsule">
        <textarea
          ref={ref}
          className="composer-input"
          aria-label={`Message ${spaceName}`}
          rows={1}
          maxLength={8000}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          enterKeyHint="send"
        />
        <button type="submit" className="send" disabled={!canSend} aria-label="Send" title="Send">
          <ArrowUp size={15} strokeWidth={2.4} />
        </button>
      </div>
    </form>
  );
}
