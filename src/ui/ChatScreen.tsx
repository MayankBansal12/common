import { Fragment, lazy, memo, Suspense, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowUp, ChevronLeft, RotateCw, UserPlus } from 'lucide-react';
import type { Activity, AgentProps, Invitation, Message, Person, Space, SpaceInput, TypingPerson } from '../types';
import { Avatar, SpaceBadge, Spinner } from './primitives';
import { MembersDialog } from './MembersDialog';
import { AgentAvatar, AgentFace } from './agents';
import { useAmbientTint } from './Device';
import { SITE } from '../site';
import { SpaceSheet } from './SpaceDialogs';
import { AgentsSheet } from './AgentsSheet';
import { tone } from './palette';
import { isJumboEmoji, renderMessage } from './markdown';
import { dayKey, dayLabel, timeOf } from './format';

type Props = {
  user: Person;
  space: Space;
  messages: Message[];
  typing: TypingPerson[];
  members: Person[];
  spaces: Space[];
  agents?: AgentProps;
  invitations: Invitation[];
  activities: Activity[];
  isOnline: boolean;
  isLoadingMessages: boolean;
  hasMoreMessages: boolean;
  onBack: () => void;
  onSendMessage: (body: string) => Promise<void>;
  onTyping: (spaceId: string, typing: boolean) => void;
  onRetryMessage: (clientId: string) => void;
  onLoadMoreMessages: () => void;
  onInviteMember: (email: string) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onRevokeInvite: (id: string) => Promise<void>;
  onUpdateSpace: (input: SpaceInput) => Promise<void>;
};

const keyOf = (m: Message) => m.clientId || m.id;
// An agent's messages are its own, never its person's: they group separately and sit on the left.
const authorOf = (m: Message) => (m.agent ? `agent:${m.agent.id}` : `person:${m.sender.id}`);
const isMine = (m: Message | undefined, userId: string) => !!m && !m.agent && m.sender.id === userId;

// The rich-text editor is the heaviest part of the app; it loads on its own, fetched in the
// background at startup so it is usually ready before a chat is opened.
const loadComposer = () => import('./Composer');
const Composer = lazy(() => loadComposer().then((m) => ({ default: m.Composer })));
if (typeof window !== 'undefined') {
  const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500));
  idle(() => void loadComposer().catch(() => {}));
}

/** Stands in for the composer for the moment it may still be loading. */
function ComposerFallback({ spaceName }: { spaceName: string }) {
  return (
    <div className="composer" aria-hidden="true">
      <div className="capsule">
        <div className="composer-field">
          <div className="composer-input" />
          <div className="composer-placeholder">Message {spaceName}</div>
        </div>
        <span className="send" data-disabled>
          <ArrowUp size={15} strokeWidth={2.4} />
        </span>
      </div>
    </div>
  );
}
const TIME_REVEAL = 76;
// Messages from one person within a few minutes stack into a group; longer gaps get a time divider.
const GROUP_GAP = 5 * 60_000;
const DIVIDER_GAP = 15 * 60_000;
// Under the avatar there's only room for a first name; the full name shows on hover.
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const breaksAt = (a: Message, b: Message) => dayKey(a.createdAt) !== dayKey(b.createdAt) || b.createdAt - a.createdAt > DIVIDER_GAP;
const NEAR_BOTTOM = 48;

export function ChatScreen(p: Props) {
  const { user, space, messages } = p;
  const reduce = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const agentsButton = useRef<HTMLButtonElement>(null);
  const [editOpen, setEditOpen] = useState(false);
  useAmbientTint(space.color);
  const typers = useActiveTypers(p.typing);
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
        if (atBottom.current || stickNext.current || isMine(tail, user.id)) {
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

  // Keep the newest activity in view when someone starts typing and the reader is at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && typers.length && atBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [typers.length, reduce]);

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

  const stack = p.members.slice(0, 3);

  let lastMineIdx = messages.length - 1;
  while (lastMineIdx >= 0 && !isMine(messages[lastMineIdx], user.id)) lastMineIdx--;

  return (
    <div className="screen chat">
      <header className="chat-head" data-scrolled={scrolled || undefined}>
        <button type="button" className="icon-btn" aria-label="Back to spaces" title="Back to spaces" onClick={p.onBack}>
          <ChevronLeft size={19} />
        </button>
        <button type="button" className="chat-title" onClick={() => setEditOpen(true)} aria-label={`Edit ${space.name}`} title="Edit space">
          <SpaceBadge symbol={space.symbol} name={space.name} color={space.color} imageUrl={space.imageUrl} size={34} />
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
          {p.members.length > stack.length && <span className="stack-more">+{p.members.length - stack.length}</span>}
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
          {!p.isLoadingMessages && messages.length === 0 && (
            <EmptyChat
              space={space}
              user={user}
              members={p.members}
              onSayHi={() => {
                stickNext.current = true;
                void p.onSendMessage('Hi everyone 👋').catch(() => {});
              }}
              onInvite={() => setMembersOpen(true)}
              onAgents={() => setAgentsOpen(true)}
              agentsButton={agentsButton}
              hasAgents={!!p.agents}
            />
          )}
          {/* Drag the thread left to reveal each message's time, as in iMessage. */}
          <motion.ol
            className="messages"
            role="log"
            aria-label={`Messages in ${space.name}`}
            drag={reduce ? false : 'x'}
            dragDirectionLock
            dragConstraints={{ left: -TIME_REVEAL, right: 0 }}
            dragElastic={{ left: 0.12, right: 0 }}
            dragMomentum={false}
            dragSnapToOrigin
          >
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const divider = !prev || breaksAt(prev, m);
              const first = divider || authorOf(prev) !== authorOf(m) || m.createdAt - prev.createdAt > GROUP_GAP;
              const last = !next || breaksAt(m, next) || authorOf(next) !== authorOf(m) || next.createdAt - m.createdAt > GROUP_GAP;
              const k = keyOf(m);
              const animate = ready && !known.current.has(k) && i > prevTailIdx;
              return (
                <Fragment key={k}>
                  {divider && (
                    <li className="day">
                      <span>
                        <b>{dayLabel(m.createdAt)}</b> {timeOf(m.createdAt)}
                      </span>
                    </li>
                  )}
                  <MessageRow
                    m={m}
                    mine={isMine(m, user.id)}
                    first={first}
                    last={last}
                    latestMine={i === lastMineIdx}
                    animate={animate}
                    onRetry={p.onRetryMessage}
                  />
                </Fragment>
              );
            })}
          </motion.ol>
          <AnimatePresence>{typers.length > 0 && <TypingRow key="typing" people={typers} />}</AnimatePresence>
        </div>
      </div>

      {/* The jump button floats just above the composer, however tall the composer grows. */}
      <div className="chat-foot">
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

        <Suspense fallback={<ComposerFallback spaceName={space.name} />}>
          <Composer
            key={`${user.id}:${space.id}`}
            draftKey={`common:draft:${user.id}:${space.id}`}
            spaceName={space.name}
            onTyping={(typing) => p.onTyping(space.id, typing)}
            onSend={(body) => {
              stickNext.current = true;
              return p.onSendMessage(body);
            }}
            isQueued={(body) => latest.current.some((m) => isMine(m, user.id) && m.body === body && m.status !== 'sent')}
          />
        </Suspense>
      </div>

      <SpaceSheet open={editOpen} onOpenChange={setEditOpen} space={space} onSubmit={p.onUpdateSpace} />
      {p.agents && <AgentsSheet open={agentsOpen} onOpenChange={setAgentsOpen} spaces={p.spaces} agents={p.agents} space={space} returnFocus={agentsButton} />}
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

/** A new space: its badge, who it's for (you, your people, your agents) and a first step. */
function EmptyChat({ space, user, members, onSayHi, onInvite, onAgents, agentsButton, hasAgents }: { space: Space; user: Person; members: Person[]; onSayHi: () => void; onInvite: () => void; onAgents: () => void; agentsButton: RefObject<HTMLButtonElement | null>; hasAgents: boolean }) {
  const others = members.filter((m) => m.id !== user.id);
  const enter = (i: number) => ({
    initial: { opacity: 0, scale: 0.6, y: 6 },
    animate: { opacity: 1, scale: 1, y: 0 },
    transition: { type: 'spring' as const, stiffness: 420, damping: 24, delay: 0.15 + i * 0.09 },
  });
  return (
    <motion.div className="chat-empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}>
      <SpaceBadge symbol={space.symbol} name={space.name} color={space.color} imageUrl={space.imageUrl} size={68} />
      <h2 className="chat-empty-title">{space.name}</h2>
      <p className="chat-empty-body">{SITE.tagline}</p>

      <div className="circle-row" aria-label="Who this space is for">
        <motion.div className="seat" {...enter(0)}>
          <span className="seat-ring">
            <Avatar person={user} size={40} />
          </span>
          <span className="seat-label">You</span>
        </motion.div>
        <motion.div className="seat" {...enter(1)}>
          {others.length ? (
            <span className="seat-ring" title={others.map((o) => o.name).join(', ')}>
              <Avatar person={others[0]} size={40} />
              {others.length > 1 && <span className="seat-count">+{others.length - 1}</span>}
            </span>
          ) : (
            <button type="button" className="seat-ring seat-empty" onClick={onInvite} aria-label="Invite people" title="Invite people">
              <UserPlus size={16} aria-hidden="true" />
            </button>
          )}
          <span className="seat-label">People</span>
        </motion.div>
        <motion.button ref={agentsButton} type="button" className="seat seat-agents" onClick={onAgents} disabled={!hasAgents} aria-label={`Agents in ${space.name}`} title="Agents" {...enter(2)}>
          <span className="seat-ring" aria-hidden="true">
            <AgentAvatar agent="claude" size={40} />
          </span>
          <span className="seat-label">Agents</span>
        </motion.button>
      </div>

      <div className="chat-empty-actions">
        <button type="button" className="chip" onClick={onSayHi}>
          👋 Say hi
        </button>
        <button type="button" className="chip chip-primary" onClick={onInvite}>
          <UserPlus size={13} aria-hidden="true" />
          Invite people
        </button>
      </div>
    </motion.div>
  );
}

// Messages taller than ~17 lines collapse to ~13 with a fade and "Read more" (as in WhatsApp),
// so one long message can't take over the thread.
const COLLAPSE_OVER = 330;
const COLLAPSED_HEIGHT = 250;

function MessageBody({ body, startOpen }: { body: string; startOpen: boolean }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [tall, setTall] = useState(false);
  // A message you've just sent shows in full once; everything else starts collapsed.
  const [open, setOpen] = useState(startOpen);

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    // offsetHeight is layout size, unaffected by the phone's scaling or the bubble's entry animation.
    // Measuring in a layout effect means the collapsed size is applied before the first paint.
    const measure = () => setTall(el.offsetHeight > COLLAPSE_OVER);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Collapsing is instant (a CSS height, so nothing flashes when a chat opens); only expanding
  // animates, as a height transition from the collapsed height to the measured full height. The
  // inline height is owned here, not by React, so re-rendering can't cut the transition short.
  function expand() {
    const el = outer.current;
    const full = inner.current?.offsetHeight;
    setOpen(true);
    if (!el || !full || reduce) return;
    el.style.height = `${COLLAPSED_HEIGHT}px`;
    el.dataset.expanding = '';
    requestAnimationFrame(() => {
      el.style.height = `${full}px`;
      el.addEventListener(
        'transitionend',
        () => {
          el.style.height = '';
          delete el.dataset.expanding;
        },
        { once: true },
      );
    });
  }

  const collapsed = tall && !open;
  return (
    <>
      <div ref={outer} className="msg-body" data-collapsed={collapsed || undefined}>
        <div ref={inner}>{renderMessage(body)}</div>
      </div>
      {collapsed && (
        <button type="button" className="read-more" aria-expanded={false} onClick={expand}>
          Read more
        </button>
      )}
    </>
  );
}

/** Typing signals still within their lifetime, re-checked each second so lapsed ones disappear. */
function useActiveTypers(typing: TypingPerson[]) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!typing.length) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [typing]);
  return typing.filter((t) => t.expiresAt > now);
}

/** The "…" bubble from onboarding, for whoever is composing: avatar, first name, softly pulsing dots. */
function TypingRow({ people }: { people: TypingPerson[] }) {
  const lead = people[0];
  const names = people.map((p) => firstName(p.name));
  const label = names.length === 1 ? `${names[0]} is typing` : names.length === 2 ? `${names[0]} and ${names[1]} are typing` : `${names[0]} and ${names.length - 1} others are typing`;
  return (
    <motion.div
      className="msg theirs typing-row"
      data-first
      data-last
      role="status"
      aria-label={label}
      initial={{ opacity: 0, y: 10, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 520, damping: 32 }}
      style={{ transformOrigin: '0% 100%' }}
    >
      <span className="msg-avatar">
        <Avatar person={lead} size={28} />
        <span className="msg-name">{people.length > 1 ? `${names[0]} +${people.length - 1}` : names[0]}</span>
      </span>
      <div className="bubble tail typing-dots" style={{ '--b-bg': tone(lead.color).bg, '--b-ink': tone(lead.color).ink } as CSSProperties} aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </motion.div>
  );
}

const MessageRow = memo(function MessageRow({
  m,
  mine,
  first,
  last,
  latestMine,
  animate,
  onRetry,
}: {
  m: Message;
  mine: boolean;
  first: boolean;
  last: boolean;
  latestMine: boolean;
  animate: boolean;
  onRetry: (clientId: string) => void;
}) {
  const t = tone(m.sender.color);
  const status = m.status ?? 'sent';
  const jumbo = isJumboEmoji(m.body);
  const time = timeOf(m.createdAt);
  const agentLabel = m.agent ? `${m.agent.name} for ${m.sender.name}` : null;
  return (
    <motion.li
      className={`msg ${mine ? 'mine' : 'theirs'}`}
      data-agent={m.agent ? true : undefined}
      data-status={status}
      data-first={first || undefined}
      data-last={last || undefined}
      initial={animate ? { opacity: 0, y: 12, scale: 0.94 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 560, damping: 34, mass: 0.7 }}
      style={{ transformOrigin: mine ? '100% 100%' : '0% 100%' } as CSSProperties}
    >
      {/* People have a short name under their avatar; agents are attributed above the bubble. */}
      {!mine && (
        <span className="msg-avatar">
          {last &&
            (m.agent ? (
              <span title={agentLabel!}>
                <AgentFace size={28} color={m.sender.color} />
              </span>
            ) : (
              <>
                <Avatar person={m.sender} size={28} />
                <span className="msg-name" title={m.sender.name}>
                  {firstName(m.sender.name)}
                </span>
              </>
            ))}
        </span>
      )}
      <div className="msg-stack">
        {m.agent && first && (
          <span className="msg-agent" title={agentLabel!} aria-hidden="true">
            <b>{m.agent.name}</b>{' for '}
            <span className="msg-agent-person">
              <Avatar person={m.sender} size={14} />
              <span>{m.sender.name}</span>
            </span>
          </span>
        )}
        <div
          className={jumbo ? 'bubble jumbo' : `bubble${last ? ' tail' : ''}`}
          style={{ '--b-bg': t.bg, '--b-ink': t.ink } as CSSProperties}
          title={time}
        >
          <span className="sr-only">{mine ? 'You' : agentLabel ?? m.sender.name}: </span>
          {jumbo ? m.body.trim() : <MessageBody body={m.body} startOpen={mine && animate} />}
        </div>
        {status === 'sending' && <span className="msg-status">Sending…</span>}
        {status === 'failed' && (
          <span className="msg-status failed">
            Not delivered
            <button type="button" className="retry" onClick={() => onRetry(m.clientId)} aria-label="Retry sending message" title="Retry">
              <RotateCw size={11} aria-hidden="true" />
              Retry
            </button>
          </span>
        )}
        {status === 'sent' && mine && latestMine && <span className="msg-status">Delivered</span>}
      </div>
      <time className="msg-time" dateTime={new Date(m.createdAt).toISOString()}>
        {time}
      </time>
    </motion.li>
  );
});
