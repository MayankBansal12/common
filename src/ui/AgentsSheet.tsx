import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronLeft, ChevronRight, Copy, KeyRound, Link2, SquareTerminal, type LucideIcon } from 'lucide-react';
import type { AgentConnection, AgentGrant, AgentProps, AgentScope, Space } from '../types';
import { InlineError, Sheet, SpaceBadge, Spinner } from './primitives';
import { AgentAvatar, AgentFace, AgentGlyph } from './agents';
import { shellQuote } from '../mcpUrl';
import { ago, errorText } from './format';
import { useAction } from './hooks';
import { agentHasSpaceAccess } from './agentAccess';

/** Plain-language permissions, in the order people see them. */
export const SCOPE_COPY: { scope: AgentScope; title: string; body: string }[] = [
  { scope: 'messages:read', title: 'Read messages', body: 'Never marks them read for you.' },
  { scope: 'messages:send', title: 'Send messages', body: 'Labelled as your agent, never as you.' },
  { scope: 'spaces:manage', title: 'Manage spaces', body: 'Create and rename spaces, invite people, and remove members from spaces you own.' },
  { scope: 'profile:write', title: 'Edit profile', body: 'Change your name and avatar.' },
];
export const DEFAULT_GRANT_SCOPES: AgentScope[] = ['messages:read', 'messages:send'];

export function summarizeGrant(c: Pick<AgentConnection, 'scopes' | 'spaceMode' | 'spaces'>) {
  const can = SCOPE_COPY.filter((s) => c.scopes.includes(s.scope)).map((s) => s.title.split(' ')[0].toLowerCase());
  const what = can.length ? `Can ${can.length > 1 ? `${can.slice(0, -1).join(', ')} and ${can.at(-1)}` : can[0]}` : 'Can only see your name';
  const where = c.spaceMode === 'all' ? 'all spaces' : c.spaces.length === 1 ? c.spaces[0].name : `${c.spaces.length} spaces`;
  return `${what} · ${where}`;
}

/** Copies text, with a short "Copied" confirmation and a manual fallback when the clipboard is unavailable. */
export function useCopy() {
  const [state, setState] = useState<{ key: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => setState(null), 2000);
    return () => clearTimeout(t);
  }, [state]);
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setState({ key, ok: true });
    } catch {
      setState({ key, ok: false });
    }
  }
  return { copy, copied: (key: string) => state?.key === key && state.ok, failed: (key: string) => state?.key === key && !state.ok };
}

/**
 * A copy button's label. Both states are laid out on top of each other, so the button is always as wide
 * as the longer one and never jumps; the swap is a short cross-fade with the check popping in.
 */
function CopyLabel({ copied, idle, Icon = Copy, size = 13 }: { copied: boolean; idle: string; Icon?: LucideIcon; size?: number }) {
  return (
    <span className="copy-label" data-copied={copied || undefined}>
      <span className="copy-label-idle" aria-hidden={copied || undefined}>
        <Icon size={size} aria-hidden="true" />
        {idle}
      </span>
      <span className="copy-label-done" aria-hidden={!copied || undefined}>
        <Check size={size} aria-hidden="true" className="copy-label-check" />
        Copied
      </span>
    </span>
  );
}

/** A read-only value with a copy button; selecting the field selects all of it for manual copying. */
export function CopyField({ label, value, copyKey, clip, mono = true }: { label: string; value: string; copyKey: string; clip: ReturnType<typeof useCopy>; mono?: boolean }) {
  const id = useId();
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="copy-field">
        <input id={id} className={`input${mono ? ' mono' : ''}`} readOnly value={value} onFocus={(e) => e.currentTarget.select()} spellCheck={false} />
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void clip.copy(copyKey, value)} aria-label={`Copy ${label.toLowerCase()}`}>
          <CopyLabel copied={clip.copied(copyKey)} idle="Copy" />
        </button>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {clip.copied(copyKey) ? `${label} copied` : ''}
      </span>
      {clip.failed(copyKey) && <p className="field-note">Couldn’t reach the clipboard. Select the text and copy it yourself.</p>}
    </div>
  );
}

/** What an agent may do and where. Shared by consent, editing and access tokens. */
export function GrantForm({
  value,
  onChange,
  spaces,
  requested,
  disabled,
  showName = true,
  namePlaceholder,
  nameOptional,
  plain,
  spaceRequired,
}: {
  value: AgentGrant;
  onChange: (next: AgentGrant) => void;
  spaces: Space[];
  /** OAuth only: permissions this agent asked for. Others can't be turned on. */
  requested?: AgentScope[] | null;
  disabled?: boolean;
  showName?: boolean;
  namePlaceholder?: string;
  /** An empty name falls back to the placeholder. */
  nameOptional?: boolean;
  /** Leaves out the always-on identity row, for screens where it's just noise. */
  plain?: boolean;
  /** Choosing "Only spaces I choose" needs at least one: say so above the list, where the choice is made. */
  spaceRequired?: boolean;
}) {
  const id = useId();
  const toggle = (scope: AgentScope, on: boolean) => onChange({ ...value, scopes: on ? [...value.scopes, scope] : value.scopes.filter((s) => s !== scope) });
  const toggleSpace = (spaceId: string, on: boolean) => onChange({ ...value, spaceIds: on ? [...value.spaceIds, spaceId] : value.spaceIds.filter((s) => s !== spaceId) });
  return (
    <>
      {showName && (
        <div>
          <label className="field-label" htmlFor={`${id}-name`}>
            Name shown in chats{nameOptional && <span className="muted"> (optional)</span>}
          </label>
          <input id={`${id}-name`} className="input" value={value.name} placeholder={namePlaceholder} maxLength={40} autoComplete="off" disabled={disabled} onChange={(e) => onChange({ ...value, name: e.target.value })} />
        </div>
      )}

      <fieldset className="grant-group" disabled={disabled}>
        <legend className="field-label">What it can do</legend>
        <div className="perm-list">
          {!plain && (
            <div className="perm-row is-fixed">
              <span className="perm-check" aria-hidden="true">
                <Check size={12} />
              </span>
              <span className="perm-text">
                <span className="perm-title">Know who you are</span>
                <span className="perm-body">Your name. Always on.</span>
              </span>
            </div>
          )}
          {SCOPE_COPY.map((s) => {
            const offered = !requested || requested.includes(s.scope);
            return (
              <label key={s.scope} className="perm-row" data-off={!offered || undefined}>
                <input type="checkbox" className="perm-input" checked={value.scopes.includes(s.scope)} disabled={!offered} onChange={(e) => toggle(s.scope, e.target.checked)} />
                <span className="perm-text">
                  <span className="perm-title">{s.title}</span>
                  <span className="perm-body">{offered ? s.body : 'This agent didn’t ask for this.'}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="grant-group" disabled={disabled}>
        <legend className="field-label">Where</legend>
        <div className="perm-list">
          <label className="perm-row">
            <input type="radio" className="perm-input" name={`${id}-mode`} checked={value.spaceMode === 'all'} onChange={() => onChange({ ...value, spaceMode: 'all' })} />
            <span className="perm-text">
              <span className="perm-title">All my spaces</span>
              <span className="perm-body">Including new ones.</span>
            </span>
          </label>
          <label className="perm-row">
            <input type="radio" className="perm-input" name={`${id}-mode`} checked={value.spaceMode === 'selected'} onChange={() => onChange({ ...value, spaceMode: 'selected' })} />
            <span className="perm-text">
              <span className="perm-title">Only spaces I choose</span>
              <span className="perm-body">New spaces stay private, except ones it creates.</span>
            </span>
          </label>
        </div>
        <AnimatePresence initial={false}>
          {value.spaceMode === 'selected' && (
            <motion.div className="space-picks" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}>
              {spaces.length === 0 ? (
                <p className="field-note">You don’t have any spaces yet.</p>
              ) : (
                <>
                  {spaceRequired && value.spaceIds.length === 0 && (
                    <p className="field-note space-picks-hint" role="status">
                      Pick at least one space, or choose All my spaces.
                    </p>
                  )}
                  <ul className="list" aria-label="Spaces to share">
                    {spaces.map((sp) => (
                      <li key={sp.id}>
                        <label className="space-pick">
                          <input type="checkbox" className="perm-input" checked={value.spaceIds.includes(sp.id)} onChange={(e) => toggleSpace(sp.id, e.target.checked)} />
                          <SpaceBadge symbol={sp.symbol} name={sp.name} color={sp.color} imageUrl={sp.imageUrl} size={24} />
                          <span className="space-pick-name">{sp.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </fieldset>
    </>
  );
}

type View = { kind: 'home' } | { kind: 'connect' } | { kind: 'other' } | { kind: 'manual' } | { kind: 'edit'; id: string } | { kind: 'token' } | { kind: 'reveal'; token: string; name: string };
const TITLES: Record<Exclude<View['kind'], 'edit'>, string> = { home: 'Agents', connect: 'Connect an agent', other: 'Other agents', manual: 'Set it up yourself', token: 'Access token', reveal: 'Access token' };
const PARENT: Partial<Record<View['kind'], 'home' | 'connect' | 'other'>> = { connect: 'home', other: 'home', edit: 'home', manual: 'other', token: 'other' };
const DEFAULT_TOKEN_NAME = 'My agent';
const TOKEN_ENV = 'COMMON_MCP_TOKEN';

/** Connected agents: pick an app to connect, then every agent with access, each editable or removable. */
export function AgentsSheet({ open, onOpenChange, spaces, agents, space, returnFocus }: { open: boolean; onOpenChange: (open: boolean) => void; spaces: Space[]; agents: AgentProps; space?: Space; returnFocus?: RefObject<HTMLElement | null> }) {
  const [view, setView] = useState<View>({ kind: 'home' });
  const scroller = useRef<HTMLDivElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  // The control that led away from a list, so going back lands focus where the person left off.
  const trigger = useRef<string | null>(null);
  useEffect(() => {
    if (open) {
      setView({ kind: 'home' });
      trigger.current = null;
    }
  }, [open, space?.id]);
  const editing = view.kind === 'edit' ? agents.connections?.find((c) => c.id === view.id) : undefined;
  // A connection removed elsewhere (or just now) returns the sheet to the list.
  useEffect(() => {
    if (view.kind === 'edit' && agents.connections && !editing) setView({ kind: 'home' });
  }, [view, agents.connections, editing]);
  // Each step starts at the top, with focus on Back (or on what opened it, when returning).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    scroller.current?.scrollTo({ top: 0 });
    const key = trigger.current;
    requestAnimationFrame(() => {
      const target = view.kind === 'home' || view.kind === 'connect' || view.kind === 'other' ? (key ? scroller.current?.querySelector<HTMLElement>(`[data-nav="${CSS.escape(key)}"]`) : null) : null;
      (target ?? backButton.current ?? scroller.current?.querySelector<HTMLElement>('h3, button'))?.focus({ preventScroll: true });
    });
  }, [view.kind]);
  const go = (next: View, from?: string) => {
    if (from) trigger.current = from;
    setView(next);
  };
  const parent = space && view.kind === 'other' ? 'connect' : PARENT[view.kind];
  const title = view.kind === 'edit' ? (editing?.name ?? 'Agent') : view.kind === 'home' && space ? `Agents in ${space.name}` : TITLES[view.kind];
  const back = parent ? (
    <button ref={backButton} type="button" className="icon-btn sm" aria-label={parent === 'home' ? 'Back to agents' : parent === 'connect' ? 'Back to connect an agent' : 'Back to other agents'} title="Back" onClick={() => go({ kind: parent }, view.kind === 'edit' ? `edit:${view.id}` : view.kind)} onPointerDown={(e) => e.stopPropagation()}>
      <ChevronLeft size={16} />
    </button>
  ) : undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} titleAddon={back} className="agents-sheet" returnFocus={returnFocus}>
      <div className="sheet-scroll" ref={scroller}>
        {agents.sampleNote && view.kind === 'home' && (
          <p className="field-note sample-note" role="note">
            {agents.sampleNote}
          </p>
        )}
        {view.kind === 'home' && (space
          ? <SpaceAgentsHome agents={agents} space={space} onConnect={() => go({ kind: 'connect' }, 'connect')} onEdit={(id) => go({ kind: 'edit', id }, `edit:${id}`)} />
          : <Home agents={agents} onOther={() => go({ kind: 'other' }, 'other')} onEdit={(id) => go({ kind: 'edit', id }, `edit:${id}`)} />)}
        {view.kind === 'connect' && (
          <section aria-labelledby="add-h">
            <h3 id="add-h" className="section-label" tabIndex={-1}>Add an agent</h3>
            <AppChoices onOther={() => go({ kind: 'other' }, 'other')} />
          </section>
        )}
        {view.kind === 'other' && <OtherAgents mcpUrl={agents.mcpUrl} onManual={() => go({ kind: 'manual' }, 'manual')} onToken={() => go({ kind: 'token' }, 'token')} />}
        {view.kind === 'manual' && agents.mcpUrl && <ManualSetup mcpUrl={agents.mcpUrl} />}
        {view.kind === 'edit' && editing && <EditAgent key={editing.id} connection={editing} spaces={spaces} agents={agents} onDone={() => setView({ kind: 'home' })} />}
        {view.kind === 'token' && <NewToken spaces={spaces} agents={agents} onCreated={(token, name) => setView({ kind: 'reveal', token, name })} />}
        {view.kind === 'reveal' && <Reveal token={view.token} name={view.name} mcpUrl={agents.mcpUrl} onDone={() => setView({ kind: 'home' })} />}
      </div>
    </Sheet>
  );
}

/**
 * Connected means the agent has made at least one signed-in request, not that it's online now.
 * A new token or approved sign-in is awaiting connection until then.
 */
export function agentStatus(c: Pick<AgentConnection, 'expired' | 'lastUsedAt'>): 'connected' | 'awaiting' | 'expired' {
  return c.expired ? 'expired' : c.lastUsedAt ? 'connected' : 'awaiting';
}
function statusText(c: AgentConnection) {
  const status = agentStatus(c);
  return status === 'expired' ? 'Expired' : status === 'awaiting' ? 'Awaiting connection' : `Connected · last used ${ago(c.lastUsedAt!)}`;
}
function AgentStatus({ connection }: { connection: AgentConnection }) {
  return (
    <span className="agent-status" data-status={agentStatus(connection)}>
      <span className="status-dot" aria-hidden="true" />
      {statusText(connection)}
    </span>
  );
}

/** Apps people pick from. Only "Other agents" works today; the big two are marked as coming. */
function AppChoices({ onOther }: { onOther: () => void }) {
  return (
    <ul className="app-choices" aria-labelledby="add-h">
      {(['claude', 'chatgpt'] as const).map((app) => (
        <li key={app}>
          <div className="app-choice" aria-disabled="true">
            <AgentAvatar agent={app} size={30} className="app-choice-icon" />
            <span className="app-choice-text">
              <span className="app-choice-name">{app === 'claude' ? 'Claude' : 'ChatGPT'}</span>
            </span>
            <span className="role-chip soon">Coming soon</span>
          </div>
        </li>
      ))}
      <li>
        <button type="button" className="app-choice" data-nav="other" onClick={onOther}>
          <span className="avatar app-choice-icon app-choice-other" style={{ width: 30, height: 30 }} aria-hidden="true">
            <AgentGlyph size={17} strokeWidth={1.9} />
          </span>
          <span className="app-choice-text">
            <span className="app-choice-name">Other agents</span>
            <span className="app-choice-sub">Claude Code, Codex, Cursor and more</span>
          </span>
          <ChevronRight size={15} className="muted" aria-hidden="true" />
        </button>
      </li>
    </ul>
  );
}

/** Account connections grouped by their effective access to the current space. */
function SpaceAgentsHome({ agents, space, onConnect, onEdit }: { agents: AgentProps; space: Space; onConnect: () => void; onEdit: (id: string) => void }) {
  const connections = agents.connections;
  const withAccess = connections?.filter((connection) => agentHasSpaceAccess(connection, space.id)) ?? [];
  const withoutAccess = connections?.filter((connection) => !agentHasSpaceAccess(connection, space.id)) ?? [];
  return (
    <div className="stack roomy">
      {connections === undefined ? (
        <p className="muted small loading-line" role="status"><Spinner size={13} /> Loading your agents…</p>
      ) : (
        <>
          <SpaceAgentList title="In this space" id="space-agents-h" connections={withAccess} empty="None of your agents have access to this space yet." onEdit={onEdit} />
          <SpaceAgentList title="Without access" id="other-space-agents-h" connections={withoutAccess} empty="No other agents on your account." onEdit={onEdit} />
        </>
      )}
      <button type="button" className="btn btn-primary btn-block btn-lg" data-nav="connect" onClick={onConnect}>
        <Link2 size={15} aria-hidden="true" /> Connect more agents
      </button>
    </div>
  );
}

function SpaceAgentList({ title, id, connections, empty, onEdit }: { title: string; id: string; connections: AgentConnection[]; empty: string; onEdit: (id: string) => void }) {
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="section-label">{title}</h3>
      {connections.length ? (
        <ul className="list people">
          {connections.map((connection) => (
            <li key={connection.id}>
              <button type="button" className="person-row agent-row" data-nav={`edit:${connection.id}`} onClick={() => onEdit(connection.id)} aria-label={`${connection.name}: ${statusText(connection)}. Manage access`}>
                <AgentFace size={30} />
                <span className="row-main">
                  <span className="row-title">{connection.name}</span>
                  <span className="row-sub">{summarizeGrant(connection)}</span>
                  <AgentStatus connection={connection} />
                </span>
                <ChevronRight size={14} className="muted" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="small muted">{empty}</p>}
    </section>
  );
}

/** Ways to add an agent, then every account connection and its status. */
function Home({ agents, onOther, onEdit }: { agents: AgentProps; onOther: () => void; onEdit: (id: string) => void }) {
  return (
    <div className="stack roomy">
      <section aria-labelledby="add-h">
        <h3 id="add-h" className="section-label" tabIndex={-1}>
          Add an agent
        </h3>
        <AppChoices onOther={onOther} />
      </section>

      {agents.connections === undefined ? (
        <p className="muted small loading-line" role="status">
          <Spinner size={13} /> Loading your agents…
        </p>
      ) : (
        agents.connections.length > 0 && (
          <section aria-labelledby="yours-h">
            <h3 id="yours-h" className="section-label">
              Your agents
            </h3>
            <ul className="list people">
              {agents.connections.map((c) => (
                <li key={c.id}>
                  <button type="button" className="person-row agent-row" data-nav={`edit:${c.id}`} onClick={() => onEdit(c.id)} aria-label={`${c.name}: ${statusText(c)}. ${summarizeGrant(c)}. Edit`}>
                    <AgentFace size={30} />
                    <span className="row-main">
                      <span className="row-title">{c.name}</span>
                      <span className="row-sub">{summarizeGrant(c)}</span>
                      <AgentStatus connection={c} />
                    </span>
                    <ChevronRight size={14} className="muted" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      )}
    </div>
  );
}

/** Commands for the two CLIs people ask about most, plus a generic config. With a token, every one reads it from `COMMON_MCP_TOKEN`. */
function setupFor(mcpUrl: string, withToken = false) {
  const url = shellQuote(mcpUrl);
  return {
    // A literal reference in the project's .mcp.json, which Claude Code fills in when it starts: the token never
    // appears in the command or the file.
    claudeCode: withToken
      ? `claude mcp add --transport http --scope project common ${url} --header ${shellQuote(`Authorization: Bearer \${${TOKEN_ENV}}`)}`
      : `claude mcp add --transport http common ${url}`,
    codex: `codex mcp add common --url ${url}${withToken ? ` --bearer-token-env-var ${TOKEN_ENV}` : ''}`,
    json: JSON.stringify({ mcpServers: { common: { type: 'http', url: mcpUrl, ...(withToken && { headers: { Authorization: `Bearer \${${TOKEN_ENV}}` } }) } } }, null, 2),
  };
}

/**
 * Setup instructions to paste into an agent that can run commands or edit its own MCP settings.
 * It describes the browser sign-in only: it never carries a token, and the person still approves in Common.
 */
export function setupPrompt(mcpUrl: string) {
  const { claudeCode, codex } = setupFor(mcpUrl);
  return `Connect yourself to Common, my group chat app, using its MCP server.

Server URL: ${mcpUrl}
It's a remote MCP server over HTTP. Sign-in is OAuth in my browser, so no API key is needed.

1. Add the server to your MCP settings with the name "common". For example:
   Claude Code: ${claudeCode}
   Codex: ${codex}
   Other apps: add the URL to your MCP config.
2. Start sign-in so Common opens in my browser, where I'll approve it. If you can't start it yourself, tell me how (in Claude Code I run /mcp; in Codex, codex mcp login common).
3. Once connected, call whoami to check it works, then list_spaces if you have it. Tell me what you can see.

If a step needs me, like approving sign-in or restarting you so the new tools load, tell me exactly what to do. Never ask me for my password.`;
}

/**
 * Setup instructions for an access token. It takes no token on purpose: it only names the variable the
 * agent reads, and asks the agent to explain where its own app keeps secrets.
 */
export function tokenSetupPrompt(mcpUrl: string) {
  const { codex } = setupFor(mcpUrl, true);
  return `Connect yourself to Common, my group chat app, using its MCP server.

Server URL: ${mcpUrl}
It's a remote MCP server over HTTP that needs the header "Authorization: Bearer <token>". I have an access token for it and will provide it privately as ${TOKEN_ENV}.

1. Work out how your app can read a secret for an MCP server header, such as an environment variable. Tell me exactly where and how to set ${TOKEN_ENV}, then wait for me to do it. Never ask me to paste the token into this chat.
2. Add the server with the name "common", reading the token from ${TOKEN_ENV}. For example:
   Codex: ${codex}
   Claude Code: a .mcp.json entry with "headers": { "Authorization": "Bearer \${${TOKEN_ENV}}" }, written literally; Claude Code fills it in when it starts.
3. Keep the token secret: refer to ${TOKEN_ENV} by name and never expand it into a command, file, URL or output. Don't list my environment variables or secrets.
4. Once it's set (you may need a restart for the tools to load), call whoami to check it works, then list_spaces if you have it. Tell me what you can see.`;
}

/**
 * The easy path: one button copies the whole prompt. The text stays tucked away unless someone asks to
 * read it, or the clipboard fails and they need to select it themselves.
 */
function PromptCopy({
  prompt,
  clip,
  copyKey,
  children,
  viewable = true,
}: {
  prompt: string;
  clip: ReturnType<typeof useCopy>;
  copyKey: string;
  /** Sits beside the copy button, in the same row. */
  children?: ReactNode;
  /** Offer a "View prompt" toggle. Without it the text only appears if the clipboard fails. */
  viewable?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const failed = clip.failed(copyKey);
  useEffect(() => {
    if (failed) setShown(true);
  }, [failed]);
  // Runs once the prompt is on screen, so it can be selected for copying by hand.
  useEffect(() => {
    if (!failed || !shown) return;
    field.current?.focus();
    field.current?.select();
  }, [failed, shown]);
  return (
    <div className="prompt-copy">
      <div className="copy-row">
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => void clip.copy(copyKey, prompt)}>
          <CopyLabel copied={clip.copied(copyKey)} idle="Copy setup prompt" size={15} />
        </button>
        {children}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {clip.copied(copyKey) ? 'Setup prompt copied' : ''}
      </span>
      {failed && <p className="field-note">Couldn’t reach the clipboard. Select the prompt below and copy it.</p>}
      {viewable && (
        <button type="button" className="link-btn disclose" aria-expanded={shown} onClick={() => setShown((v) => !v)}>
          <ChevronRight size={12} aria-hidden="true" className="disclose-icon" />
          {shown ? 'Hide prompt' : 'View prompt'}
        </button>
      )}
      <AnimatePresence initial={false}>
        {shown && (
          <motion.div className="reveal-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}>
            <textarea ref={field} className="prompt-view" readOnly value={prompt} rows={10} aria-label="Setup prompt" spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A row that leads to another step, in the same style as the app list. */
function NavRow({ nav, icon, title, sub, onClick }: { nav: string; icon: ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="app-choice" data-nav={nav} onClick={onClick}>
        <span className="fallback-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="app-choice-text">
          <span className="app-choice-name">{title}</span>
          <span className="app-choice-sub">{sub}</span>
        </span>
        <ChevronRight size={14} className="muted" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Just the server address, for agents that only ask for a URL. If copying fails, the address stays on screen, selected. */
function AddressCopy({ mcpUrl, clip }: { mcpUrl: string; clip: ReturnType<typeof useCopy> }) {
  const failed = clip.failed('url');
  const [fallback, setFallback] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (failed) setFallback(true);
  }, [failed]);
  useEffect(() => {
    if (!failed || !fallback) return;
    field.current?.focus();
    field.current?.select();
  }, [failed, fallback]);
  return (
    <>
      <button type="button" className="btn btn-outline btn-block btn-lg" onClick={() => void clip.copy('url', mcpUrl)}>
        <CopyLabel copied={clip.copied('url')} idle="Copy MCP address" Icon={Link2} size={14} />
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {clip.copied('url') ? 'MCP address copied' : ''}
      </span>
      {fallback && (
        <div className="address-fallback">
          <input ref={field} className="input mono" readOnly value={mcpUrl} aria-label="MCP address" spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
          <p className="field-note">Couldn’t reach the clipboard. Copy the address yourself.</p>
        </div>
      )}
    </>
  );
}

/** Any MCP client: copy a prompt for the agent to set itself up. Manual setup and tokens are a step away. */
function OtherAgents({ mcpUrl, onManual, onToken }: { mcpUrl: string | null; onManual: () => void; onToken: () => void }) {
  const clip = useCopy();
  if (!mcpUrl) {
    return (
      <div className="notice" role="alert">
        <p className="notice-title">Connecting agents isn’t available right now</p>
        <p className="small muted">Agents you’ve already connected keep working.</p>
      </div>
    );
  }
  return (
    <div className="stack roomy">
      <section className="connect-intro" aria-label="Let your agent set it up">
        <p className="connect-lead">Paste the prompt into Claude Code, Codex or another agent that can run commands. You’ll approve it in Common.</p>
        <PromptCopy prompt={setupPrompt(mcpUrl)} clip={clip} copyKey="prompt" viewable={false}>
          <AddressCopy mcpUrl={mcpUrl} clip={clip} />
        </PromptCopy>
      </section>

      <section aria-labelledby="ways-h">
        <h3 id="ways-h" className="section-label">
          Other ways
        </h3>
        <ul className="app-choices">
          <NavRow nav="manual" icon={<SquareTerminal size={15} />} title="Set it up yourself" sub="Server URL, commands and config" onClick={onManual} />
          <NavRow nav="token" icon={<KeyRound size={15} />} title="Use an access token" sub="For agents without browser sign-in" onClick={onToken} />
        </ul>
      </section>
    </div>
  );
}

/** The URL and ready-made commands, for people who'd rather do it by hand. */
function ManualSetup({ mcpUrl }: { mcpUrl: string }) {
  const clip = useCopy();
  const { claudeCode, codex, json } = setupFor(mcpUrl);
  return (
    <div className="stack roomy">
      <div>
        <CopyField label="Server URL" value={mcpUrl} copyKey="url" clip={clip} />
        <p className="field-note">Add it as a remote MCP server, then sign in from your agent.</p>
      </div>
      <SetupCommands clip={clip} claudeCode={claudeCode} codex={codex} json={json} claudeNote={<>Then run <code>/mcp</code> in Claude Code to sign in.</>} codexNote={<>If sign-in doesn’t open, run <code>codex mcp login common</code>.</>} />
    </div>
  );
}

function SetupCommands({ clip, claudeCode, codex, json, claudeNote, codexNote }: { clip: ReturnType<typeof useCopy>; claudeCode: string; codex: string; json: string; claudeNote: ReactNode; codexNote: ReactNode }) {
  return (
    <div className="stack">
      <div>
        <CopyField label="Claude Code" value={claudeCode} copyKey="cc" clip={clip} />
        <p className="field-note">{claudeNote}</p>
      </div>
      <div>
        <CopyField label="Codex" value={codex} copyKey="codex" clip={clip} />
        <p className="field-note">{codexNote}</p>
      </div>
      <CodeBlock label="JSON config (formats vary by app)" code={json} copyKey="json" clip={clip} />
    </div>
  );
}

function CodeBlock({ label, code, copyKey, clip }: { label: string; code: string; copyKey: string; clip: ReturnType<typeof useCopy> }) {
  return (
    <div>
      <span className="field-label">{label}</span>
      {/* The copy button rides in the box's corner, in the same style as the copy fields above it. */}
      <div className="code-wrap">
        <pre className="code-block">{code}</pre>
        <button type="button" className="btn btn-outline btn-sm code-copy" onClick={() => void clip.copy(copyKey, code)} aria-label={`Copy ${label}`}>
          <CopyLabel copied={clip.copied(copyKey)} idle="Copy" />
        </button>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {clip.copied(copyKey) ? 'Config copied' : ''}
      </span>
      {clip.failed(copyKey) && <p className="field-note">Couldn’t reach the clipboard. Select the text and copy it yourself.</p>}
    </div>
  );
}

const grantOf = (c: AgentConnection): AgentGrant => ({ name: c.name, scopes: c.scopes, spaceMode: c.spaceMode, spaceIds: c.spaces.map((s) => s.id) });
const sameGrant = (a: AgentGrant, b: AgentGrant) =>
  a.name.trim() === b.name.trim() && a.spaceMode === b.spaceMode && [...a.scopes].sort().join() === [...b.scopes].sort().join() && (a.spaceMode === 'all' || [...a.spaceIds].sort().join() === [...b.spaceIds].sort().join());

function EditAgent({ connection, spaces, agents, onDone }: { connection: AgentConnection; spaces: Space[]; agents: AgentProps; onDone: () => void }) {
  const [grant, setGrant] = useState(() => grantOf(connection));
  const save = useAction();
  const remove = useAction();
  const [confirming, setConfirming] = useState(false);
  const busy = save.busy || remove.busy;
  const unchanged = sameGrant(grant, grantOf(connection));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !grant.name.trim()) return;
    if (unchanged) return onDone();
    if (await save.run(() => agents.onUpdate(connection.id, { ...grant, name: grant.name.trim() }))) onDone();
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="agent-meta">
        <AgentFace size={34} />
        <div className="row-main">
          <AgentStatus connection={connection} />
          <span className="row-sub">
            {connection.kind === 'oauth' ? connection.clientName ?? 'Browser sign-in' : 'Access token'}
            {` · added ${ago(connection.createdAt)}`}
            {connection.expiresAt && !connection.expired ? ` · expires ${new Date(connection.expiresAt).toLocaleDateString()}` : ''}
          </span>
        </div>
      </div>
      <GrantForm value={grant} onChange={setGrant} spaces={spaces} requested={connection.requestedScopes} disabled={busy} />
      <InlineError>{save.error ?? remove.error}</InlineError>
      <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy || !grant.name.trim()}>
        {save.busy && <Spinner />}
        Save changes
      </button>
      <div className="danger-zone" data-confirm={confirming || undefined}>
        {confirming ? (
          <div className="confirm-block" role="group" aria-label={`Remove ${connection.name}?`}>
            <p className="small">
              <strong>{connection.name}</strong> loses access right away. Its messages stay in the chat.
            </p>
            <div className="sheet-actions">
              <button type="button" className="btn btn-ghost btn-sm" autoFocus disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void remove.run(() => agents.onRevoke(connection.id))}>
                {remove.busy && <Spinner size={12} />}
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-block danger-text" disabled={busy} onClick={() => setConfirming(true)}>
            Remove {connection.name}
          </button>
        )}
      </div>
    </form>
  );
}

function NewToken({ spaces, agents, onCreated }: { spaces: Space[]; agents: AgentProps; onCreated: (token: string, name: string) => void }) {
  const [grant, setGrant] = useState<AgentGrant>({ name: '', scopes: DEFAULT_GRANT_SCOPES, spaceMode: 'all', spaceIds: [] });
  const [expiry, setExpiry] = useState<'30' | '90' | 'never'>('90');
  const { busy, error, run } = useAction();
  const noSpaces = grant.spaceMode === 'selected' && grant.spaceIds.length === 0;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || noSpaces) return;
    const name = grant.name.trim() || DEFAULT_TOKEN_NAME;
    let token = '';
    if (await run(async () => (token = await agents.onCreateToken({ ...grant, name, expiresInDays: expiry === 'never' ? undefined : (Number(expiry) as 30 | 90) })))) onCreated(token, name);
  }
  return (
    <form className="stack" onSubmit={submit}>
      <p className="small muted">For agents without browser sign-in. It works like a password.</p>
      <GrantForm value={grant} onChange={setGrant} spaces={spaces} disabled={busy} namePlaceholder={DEFAULT_TOKEN_NAME} nameOptional plain spaceRequired />
      <fieldset className="grant-group" disabled={busy}>
        <legend className="field-label">Expires</legend>
        <div className="segmented" role="radiogroup" aria-label="Expires">
          {(['30', '90', 'never'] as const).map((v) => (
            <label key={v} className="segment" data-selected={expiry === v || undefined}>
              <input type="radio" className="sr-only" name="expiry" checked={expiry === v} onChange={() => setExpiry(v)} />
              {v === 'never' ? 'Never' : `${v} days`}
            </label>
          ))}
        </div>
      </fieldset>
      <InlineError>{error}</InlineError>
      <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy || noSpaces}>
        {busy && <Spinner />}
        Create token
      </button>
    </form>
  );
}

/**
 * The one time a token is visible. Two steps: the agent gets a prompt that names the token but never
 * contains it, then the person puts the token wherever the agent says, outside the chat.
 */
function Reveal({ token, name, mcpUrl, onDone }: { token: string; name: string; mcpUrl: string | null; onDone: () => void }) {
  const clip = useCopy();
  const [manual, setManual] = useState(false);
  const setup = mcpUrl ? setupFor(mcpUrl, true) : null;
  return (
    <div className="stack roomy">
      <p className="field-note warn flush" role="note">
        The token for <strong>{name}</strong> is shown only once.
      </p>
      <ol className="token-steps">
        {mcpUrl && (
          <li>
            <span className="step-n" aria-hidden="true">1</span>
            <div className="step-body">
              <h3 className="step-title">Give your agent the setup prompt</h3>
              <p className="step-note">Your agent tells you where the token goes. The prompt doesn’t include it.</p>
              <PromptCopy prompt={tokenSetupPrompt(mcpUrl)} clip={clip} copyKey="prompt" />
            </div>
          </li>
        )}
        <li>
          <span className="step-n" aria-hidden="true">{mcpUrl ? 2 : 1}</span>
          <div className="step-body">
            <h3 className="step-title">Put the token where it says</h3>
            <p className="step-note">
              Use the name <code>{TOKEN_ENV}</code>. Never paste it into a chat.
            </p>
            <CopyField label="Access token" value={token} copyKey="token" clip={clip} />
          </div>
        </li>
      </ol>
      {setup && mcpUrl && (
        <div className="stack tight-gap">
          <button type="button" className="link-btn disclose" aria-expanded={manual} onClick={() => setManual((m) => !m)}>
            <ChevronRight size={12} aria-hidden="true" className="disclose-icon" />
            Set it up yourself
          </button>
          <AnimatePresence initial={false}>
            {manual && (
              <motion.div className="stack tight" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}>
                <CopyField label="Server URL" value={mcpUrl} copyKey="url" clip={clip} />
                <div>
                  <CopyField label="Header" value={`Authorization: Bearer ${token}`} copyKey="header" clip={clip} />
                  <p className="field-note">For apps with a header field. Keep the token out of the URL.</p>
                </div>
                <SetupCommands
                  clip={clip}
                  claudeCode={setup.claudeCode}
                  codex={setup.codex}
                  json={setup.json}
                  claudeNote={<>Saved to this project’s <code>.mcp.json</code>. Claude Code reads <code>{TOKEN_ENV}</code> when it starts.</>}
                  codexNote={<>Codex reads <code>{TOKEN_ENV}</code> when it starts.</>}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      <button type="button" className="btn btn-outline btn-block btn-lg" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

/** A quiet "agent" marker for places that need a label rather than a face. */
export function AgentTag({ children }: { children?: ReactNode }) {
  return (
    <span className="agent-tag">
      <AgentGlyph size={11} strokeWidth={2.1} />
      {children ?? 'Agent'}
    </span>
  );
}
