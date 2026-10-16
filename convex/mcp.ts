import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { ConvexError, v } from 'convex/values';
import { maskEmail, person, rateLimit } from './lib/access';
import { agentFromToken, hasScope, MAX_GRANT_SPACES, requireAgentSpace, requireScope, SCOPE_LABELS, type AgentActor, type Scope } from './lib/agents';
import { postMessage } from './messages';
import { createSpace, updateSpace } from './spaces';
import { inviteMember, removeMember, revokeInvitation } from './members';
import { updateProfile } from './users';
import { MESSAGE_LIMIT } from './messages';

/**
 * MCP tools. Each call runs as one Convex query or mutation that resolves the token, re-checks the
 * grant (scope, spaces, expiry) and the person's live membership and role, and performs the effect,
 * all in the same transaction. The HTTP layer only parses JSON-RPC and maps errors.
 */
type Args = Record<string, unknown>;
type Tool = {
  name: string;
  title: string;
  description: string;
  /** `null`: available to every connection. An array: any one of these scopes. */
  scopes: Scope[] | null;
  write: boolean;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (ctx: MutationCtx | QueryCtx, actor: AgentActor, args: Args) => Promise<unknown>;
};

const spaceIdProp = { type: 'string', description: 'A space ID from list_spaces.' };
const COLOR_HELP = 'Color index 0–7: 0 sky, 1 rose, 2 sage, 3 amber, 4 lavender, 5 teal, 6 peach, 7 stone.';

// Argument checks: the schema is advertised, and enforced here because clients may not validate.
function only(args: Args, allowed: string[]) {
  const extra = Object.keys(args).find(k => !allowed.includes(k));
  if (extra) throw new ConvexError(`Unknown argument "${extra}".`);
}
function str(args: Args, key: string, opts: { optional?: boolean; max?: number } = {}): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    if (opts.optional) return undefined;
    throw new ConvexError(`"${key}" is required.`);
  }
  if (typeof value !== 'string') throw new ConvexError(`"${key}" must be a string.`);
  if (opts.max && value.length > opts.max) throw new ConvexError(`"${key}" must be at most ${opts.max} characters.`);
  return value;
}
function int(args: Args, key: string, min: number, max: number): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new ConvexError(`"${key}" must be a whole number from ${min} to ${max}.`);
  return value;
}
function bool(args: Args, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new ConvexError(`"${key}" must be true or false.`);
  return value;
}
function spaceId(ctx: QueryCtx, args: Args) {
  const id = ctx.db.normalizeId('spaces', str(args, 'space_id', { max: 64 })!);
  if (!id) throw new ConvexError('That space isn’t shared with this connection.');
  return id;
}
const iso = (ms: number) => new Date(ms).toISOString();
const asMutation = (ctx: QueryCtx | MutationCtx) => ctx as MutationCtx;

/**
 * Spaces this connection can use right now: in the grant and still a member. Chosen-space grants are
 * at most MAX_GRANT_SPACES, so they come back whole; all-space grants page through memberships.
 */
async function spacesFor(ctx: QueryCtx, actor: AgentActor, cursor: string | null) {
  const { connection, user } = actor;
  const live = async (membership: Doc<'memberships'> | null) => {
    const space = membership && (await ctx.db.get(membership.spaceId));
    return space && membership ? { space, membership } : null;
  };
  if (connection.spaceMode === 'selected') {
    const rows = await Promise.all(connection.spaceIds.map(async id => live(await ctx.db.query('memberships').withIndex('by_space_user', q => q.eq('spaceId', id).eq('userId', user._id)).unique())));
    return { rows: rows.filter(r => r !== null), cursor: null };
  }
  const page = await ctx.db.query('memberships').withIndex('by_user', q => q.eq('userId', user._id)).paginate({ numItems: 100, cursor });
  const rows = await Promise.all(page.page.map(live));
  return { rows: rows.filter(r => r !== null), cursor: page.isDone ? null : page.continueCursor };
}

/** One space by ID, or a page of every space this connection can use. */
async function spacesToScan(ctx: QueryCtx, actor: AgentActor, args: Args) {
  const cursor = str(args, 'cursor', { optional: true, max: 2000 }) ?? null;
  if (args.space_id === undefined || args.space_id === null) return spacesFor(ctx, actor, cursor);
  if (cursor !== null) throw new ConvexError('Use space_id or cursor, not both.');
  return { rows: [await requireAgentSpace(ctx, actor, spaceId(ctx, args))], cursor: null };
}
const byActivity = (a: { space: Doc<'spaces'> }, b: { space: Doc<'spaces'> }) => b.space.updatedAt - a.space.updatedAt;

// A catch_up page holds at most 100 spaces (see spacesFor), so this total still gives every space with
// news at least one message, and each call moves every one of them forward.
const CATCH_UP_TOTAL = 100;
// Search filters match one space at a time, so searching everywhere runs one query per space in the
// page, together reading at most this many results.
const SEARCH_READS = 200;
const SEARCH_TERMS = 16;

/** Messages as agents see them, each author a person or an agent acting for one. `names` can be shared across calls. */
async function messagesFor(ctx: QueryCtx, actor: AgentActor, messages: Doc<'messages'>[], names = new Map<Id<'users'>, string>()) {
  for (const m of messages) if (!names.has(m.senderId)) names.set(m.senderId, (await person(ctx, m.senderId)).name);
  return messages.map(m => ({
    id: m._id, sequence: m.sequence, sent_at: iso(m._creationTime), text: m.body,
    author: m.actorKind === 'agent'
      ? { kind: 'agent', agent_name: m.agentName ?? 'Agent', on_behalf_of: names.get(m.senderId), user_id: m.senderId, is_this_connection: m.agentId === actor.connection._id }
      : { kind: 'person', name: names.get(m.senderId), user_id: m.senderId, is_you: m.senderId === actor.user._id },
  }));
}

export const TOOLS: Tool[] = [
  {
    name: 'whoami',
    title: 'Who am I',
    description: 'Shows the person this agent acts for, the agent’s name as others see it, and exactly what this connection may do and where.',
    scopes: null,
    write: false,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(ctx, actor, args) {
      only(args, []);
      const me = await person(ctx, actor.user._id);
      const c = actor.connection;
      const spaces = c.spaceMode === 'all' ? 'all' : (await spacesFor(ctx, actor, null)).rows.map(r => ({ id: r.space._id, name: r.space.name }));
      return {
        user: { id: me.id, name: me.name },
        agent: { id: c._id, name: c.name, connected_via: c.kind === 'oauth' ? c.clientName ?? 'OAuth client' : 'access token', note: `Messages you send appear as "${c.name}", an agent acting for ${me.name}.` },
        permissions: ['Know who you are', ...c.scopes.map(s => SCOPE_LABELS[s as Scope] ?? s)],
        scopes: c.scopes,
        spaces,
        spaces_note: c.spaceMode === 'all' ? `All of ${me.name}’s spaces, including new ones.` : 'Only the listed spaces, plus spaces this agent creates.',
        expires_at: c.expiresAt ? iso(c.expiresAt) : null,
      };
    },
  },
  {
    name: 'list_spaces',
    title: 'List spaces',
    description: 'Lists the spaces shared with this connection. Unread counts and last-message previews need permission to read messages. If next_cursor is not null, call again with it for more.',
    scopes: ['messages:read', 'messages:send', 'spaces:manage'],
    write: false,
    inputSchema: { type: 'object', properties: { cursor: { type: 'string', description: 'next_cursor from a previous call.' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(ctx, actor, args) {
      only(args, ['cursor']);
      const canRead = hasScope(actor, 'messages:read');
      const { rows, cursor } = await spacesFor(ctx, actor, str(args, 'cursor', { optional: true, max: 2000 }) ?? null);
      return {
        spaces: rows.sort((a, b) => b.space.updatedAt - a.space.updatedAt).map(({ space, membership }) => ({
          id: space._id, name: space.name, symbol: space.symbol, color: space.color, role: membership.role, member_count: space.memberCount,
          last_activity_at: iso(space.updatedAt), latest_sequence: space.messageCount,
          ...(canRead ? { unread: Math.max(0, space.messageCount - membership.lastReadSequence), last_message: space.lastMessage ?? null } : {}),
        })),
        next_cursor: cursor,
      };
    },
  },
  {
    name: 'read_messages',
    title: 'Read messages',
    description: 'Reads messages in a space, oldest first within the page. By default returns the latest messages; pass before_sequence to page back or after_sequence to catch up. Reading does not mark anything read for the person.',
    scopes: ['messages:read'],
    write: false,
    inputSchema: {
      type: 'object',
      properties: {
        space_id: spaceIdProp,
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20, description: 'How many messages to return (1–50).' },
        before_sequence: { type: 'integer', minimum: 1, description: 'Only messages older than this sequence number.' },
        after_sequence: { type: 'integer', minimum: 0, description: 'Only messages newer than this sequence number.' },
      },
      required: ['space_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(ctx, actor, args) {
      only(args, ['space_id', 'limit', 'before_sequence', 'after_sequence']);
      const id = spaceId(ctx, args);
      const limit = int(args, 'limit', 1, 50) ?? 20;
      const before = int(args, 'before_sequence', 1, Number.MAX_SAFE_INTEGER);
      const after = int(args, 'after_sequence', 0, Number.MAX_SAFE_INTEGER);
      if (before !== undefined && after !== undefined) throw new ConvexError('Use before_sequence or after_sequence, not both.');
      const { space } = await requireAgentSpace(ctx, actor, id);
      const rows = after !== undefined
        ? await ctx.db.query('messages').withIndex('by_space_sequence', q => q.eq('spaceId', id).gt('sequence', after)).order('asc').take(limit + 1)
        : await ctx.db.query('messages').withIndex('by_space_sequence', q => before !== undefined ? q.eq('spaceId', id).lt('sequence', before) : q.eq('spaceId', id)).order('desc').take(limit + 1);
      const more = rows.length > limit;
      const page = rows.slice(0, limit);
      if (after === undefined) page.reverse();
      return {
        space: { id: space._id, name: space.name },
        messages: await messagesFor(ctx, actor, page),
        has_more: more,
        ...(after === undefined ? { next_before_sequence: more && page[0] ? page[0].sequence : null } : { next_after_sequence: page.at(-1)?.sequence ?? after }),
      };
    },
  },
  {
    name: 'catch_up',
    title: 'Catch up',
    description: 'Shows what’s new since this connection last caught up, grouped by space, oldest first within each space. The first time, a space starts from the person’s unread messages. Each call moves this connection’s checkpoint to the last message it returned, so nothing is skipped: when a space has has_more, call again to continue. Pass peek to look without moving it. Only spaces with new messages are listed. If next_cursor is not null, call again with it for more spaces. This never marks anything read for the person.',
    scopes: ['messages:read'],
    // It writes this connection's own checkpoints, so it runs as a mutation. But it changes nothing a
    // person sees and never marks anything read, so it stays readOnlyHint: clients that ask for
    // confirmation on every other tool (ChatGPT does) then don't ask each time the agent catches up.
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { ...spaceIdProp, description: 'Only catch up on this space. A space ID from list_spaces.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20, description: `Most messages per space (1–50). Spaces share ${CATCH_UP_TOTAL} messages per call.` },
        peek: { type: 'boolean', default: false, description: 'Look without moving the checkpoint.' },
        cursor: { type: 'string', description: 'next_cursor from a previous call.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(ctx, actor, args) {
      only(args, ['space_id', 'limit', 'peek', 'cursor']);
      const limit = int(args, 'limit', 1, 50) ?? 20;
      const peek = bool(args, 'peek') ?? false;
      const { rows, cursor } = await spacesToScan(ctx, actor, args);
      const scanned = await Promise.all(rows.map(async ({ space, membership }) => {
        const checkpoint = await ctx.db.query('agentCheckpoints').withIndex('by_connection_space', q => q.eq('connectionId', actor.connection._id).eq('spaceId', space._id)).unique();
        return { space, checkpoint, from: checkpoint?.sequence ?? membership.lastReadSequence };
      }));
      // Spaces with news split the budget, most recently active first.
      const fresh = scanned.filter(s => s.space.messageCount > s.from).sort(byActivity);
      const reached = new Map<Id<'spaces'>, number>();
      const names = new Map<Id<'users'>, string>();
      const spaces = [];
      let budget = CATCH_UP_TOTAL;
      for (const [i, { space, from }] of fresh.entries()) {
        const take = Math.max(1, Math.min(limit, Math.floor(budget / (fresh.length - i))));
        const page = await ctx.db.query('messages').withIndex('by_space_sequence', q => q.eq('spaceId', space._id).gt('sequence', from)).order('asc').take(take);
        budget -= page.length;
        const to = page.at(-1)?.sequence ?? from;
        reached.set(space._id, to);
        spaces.push({
          space: { id: space._id, name: space.name },
          messages: await messagesFor(ctx, actor, page, names),
          has_more: to < space.messageCount,
          checkpoint_sequence: peek ? from : to,
          latest_sequence: space.messageCount,
        });
      }
      // Every scanned space gets a checkpoint, so later catch-ups start here even after the person reads on.
      if (!peek) {
        const m = asMutation(ctx);
        for (const { space, checkpoint, from } of scanned) {
          const sequence = reached.get(space._id) ?? from;
          if (!checkpoint) await m.db.insert('agentCheckpoints', { connectionId: actor.connection._id, spaceId: space._id, sequence });
          else if (checkpoint.sequence !== sequence) await m.db.patch(checkpoint._id, { sequence });
        }
      }
      return { spaces, next_cursor: cursor };
    },
  },
  {
    name: 'search_messages',
    title: 'Search messages',
    description: 'Finds messages containing the given words, in one space or across the spaces shared with this connection. Results are ranked by relevance within each space; across spaces, every space’s best match comes before any second-best. Each result includes its sequence: pass it to read_messages as before_sequence or after_sequence to read the conversation around it. If next_cursor is not null, call again with it to search more spaces.',
    scopes: ['messages:read'],
    write: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200, description: `Words to look for (up to ${SEARCH_TERMS}). The last word also matches as a prefix.` },
        space_id: { ...spaceIdProp, description: 'Only search this space. A space ID from list_spaces.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20, description: 'How many results to return (1–50).' },
        cursor: { type: 'string', description: 'next_cursor from a previous call.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(ctx, actor, args) {
      only(args, ['query', 'space_id', 'limit', 'cursor']);
      const query = str(args, 'query', { max: 200 })!.trim();
      if (!query) throw new ConvexError('"query" can’t be empty.');
      if (query.split(/\s+/).length > SEARCH_TERMS) throw new ConvexError(`"query" can have at most ${SEARCH_TERMS} words.`);
      const limit = int(args, 'limit', 1, 50) ?? 20;
      const { rows, cursor } = await spacesToScan(ctx, actor, args);
      const searched = rows.filter(r => r.space.messageCount > 0).sort(byActivity);
      const each = Math.min(limit, Math.max(1, Math.floor(SEARCH_READS / Math.max(1, searched.length))));
      const hits = await Promise.all(searched.map(({ space }) => ctx.db.query('messages').withSearchIndex('search_body', q => q.search('body', query).eq('spaceId', space._id)).take(each)));
      // Interleave by rank: each space's best match, then each second-best, and so on.
      const ranked: { space: Doc<'spaces'>; message: Doc<'messages'> }[] = [];
      for (let rank = 0; rank < each; rank++) hits.forEach((list, i) => list[rank] && ranked.push({ space: searched[i].space, message: list[rank] }));
      const top = ranked.slice(0, limit);
      const messages = await messagesFor(ctx, actor, top.map(r => r.message));
      return { results: top.map(({ space }, i) => ({ space: { id: space._id, name: space.name }, ...messages[i] })), next_cursor: cursor };
    },
  },
  {
    name: 'send_message',
    title: 'Send message',
    description: `Posts a message in a space, shown as this agent acting for the person. Markdown is supported. Up to ${MESSAGE_LIMIT} characters. Every message needs a new request_id; reuse the same request_id only when retrying that message, and it will never post twice.`,
    scopes: ['messages:send'],
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        space_id: spaceIdProp,
        text: { type: 'string', minLength: 1, maxLength: MESSAGE_LIMIT, description: 'The message text (Markdown).' },
        request_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,64}$', description: 'A new unique ID for each message (8–64 letters, digits, - or _), e.g. a UUID. Reuse it only to retry the same message.' },
      },
      required: ['space_id', 'text', 'request_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(ctx, actor, args) {
      only(args, ['space_id', 'text', 'request_id']);
      const id = spaceId(ctx, args);
      const text = str(args, 'text', { max: MESSAGE_LIMIT * 2 })!;
      const requestId = str(args, 'request_id', { max: 64 })!;
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new ConvexError('"request_id" must be 8–64 letters, digits, - or _.');
      const { membership } = await requireAgentSpace(ctx, actor, id);
      const clientId = `agent:${actor.connection._id}:${requestId}`;
      const sent = await postMessage(asMutation(ctx), actor, membership, text, clientId);
      return { message_id: sent.id, sequence: sent.sequence, deduplicated: sent.duplicate };
    },
  },
  {
    name: 'create_space',
    title: 'Create space',
    description: 'Creates a new space owned by the person. If this connection is limited to chosen spaces, the new space is added to them.',
    scopes: ['spaces:manage'],
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 60 },
        symbol: { type: 'string', maxLength: 16, description: 'An emoji or short symbol for the space. Defaults to ✳.' },
        color: { type: 'integer', minimum: 0, maximum: 7, description: COLOR_HELP },
      },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(ctx, actor, args) {
      only(args, ['name', 'symbol', 'color']);
      const name = str(args, 'name', { max: 200 })!;
      const symbol = str(args, 'symbol', { optional: true, max: 16 }) ?? '✳';
      const color = int(args, 'color', 0, 7) ?? 0;
      const m = asMutation(ctx);
      const selected = actor.connection.spaceMode === 'selected';
      if (selected && actor.connection.spaceIds.length >= MAX_GRANT_SPACES) throw new ConvexError('This connection already has the most spaces it can hold. Ask the person to remove some in Common.');
      const id = await createSpace(m, actor, { name, symbol, color });
      if (selected) await m.db.patch(actor.connection._id, { spaceIds: [...actor.connection.spaceIds, id] });
      return { space_id: id };
    },
  },
  {
    name: 'update_space',
    title: 'Update space',
    description: 'Renames or restyles a space. Any member can do this; it is recorded in the space’s activity.',
    scopes: ['spaces:manage'],
    write: true,
    inputSchema: {
      type: 'object',
      properties: { space_id: spaceIdProp, name: { type: 'string', minLength: 1, maxLength: 60 }, symbol: { type: 'string', maxLength: 16 }, color: { type: 'integer', minimum: 0, maximum: 7, description: COLOR_HELP } },
      required: ['space_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(ctx, actor, args) {
      only(args, ['space_id', 'name', 'symbol', 'color']);
      const id = spaceId(ctx, args);
      const name = str(args, 'name', { optional: true, max: 200 });
      const symbol = str(args, 'symbol', { optional: true, max: 16 });
      const color = int(args, 'color', 0, 7);
      const { space } = await requireAgentSpace(ctx, actor, id);
      await updateSpace(asMutation(ctx), actor, space, { name: name ?? space.name, symbol: symbol ?? space.symbol, color: color ?? space.color });
      return { space_id: id, updated: true };
    },
  },
  {
    name: 'list_members',
    title: 'List members',
    description: 'Lists a space’s members and pending invitations. Email addresses of members are included only with permission to manage spaces; pending invitations are always masked.',
    scopes: ['messages:read', 'spaces:manage'],
    write: false,
    inputSchema: { type: 'object', properties: { space_id: spaceIdProp }, required: ['space_id'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(ctx, actor, args) {
      only(args, ['space_id']);
      const id = spaceId(ctx, args);
      const { membership } = await requireAgentSpace(ctx, actor, id);
      const manage = hasScope(actor, 'spaces:manage');
      const members = await ctx.db.query('memberships').withIndex('by_space', q => q.eq('spaceId', id)).take(100);
      const invites = (await ctx.db.query('invitations').withIndex('by_space', q => q.eq('spaceId', id)).take(100)).filter(i => i.expiresAt > Date.now());
      return {
        your_role: membership.role,
        members: await Promise.all(members.map(async m => {
          const who = await person(ctx, m.userId, manage);
          return { user_id: m.userId, name: who.name, role: m.role, is_you: m.userId === actor.user._id, ...(manage ? { email: who.email } : {}) };
        })),
        pending_invitations: manage ? invites.map(i => ({ id: i._id, email: maskEmail(i.email), can_revoke: membership.role === 'owner' || i.inviterId === actor.user._id })) : [],
      };
    },
  },
  {
    name: 'invite_member',
    title: 'Invite member',
    description: 'Invites someone to a space by email. They join after signing in with that verified address. Invitations expire after seven days.',
    scopes: ['spaces:manage'],
    write: true,
    inputSchema: { type: 'object', properties: { space_id: spaceIdProp, email: { type: 'string', format: 'email', maxLength: 254 } }, required: ['space_id', 'email'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async run(ctx, actor, args) {
      only(args, ['space_id', 'email']);
      const id = spaceId(ctx, args);
      const email = str(args, 'email', { max: 254 })!;
      await requireAgentSpace(ctx, actor, id);
      return { invitation_id: await inviteMember(asMutation(ctx), actor, id, email) };
    },
  },
  {
    name: 'revoke_invitation',
    title: 'Revoke invitation',
    description: 'Cancels a pending invitation. Only the person who invited, or the space owner, can do this.',
    scopes: ['spaces:manage'],
    write: true,
    inputSchema: { type: 'object', properties: { invitation_id: { type: 'string', description: 'An invitation ID from list_members.' } }, required: ['invitation_id'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async run(ctx, actor, args) {
      only(args, ['invitation_id']);
      const invitationId = ctx.db.normalizeId('invitations', str(args, 'invitation_id', { max: 64 })!);
      const invite = invitationId ? await ctx.db.get(invitationId) : null;
      if (!invite) throw new ConvexError('Invitation not found.');
      const { membership } = await requireAgentSpace(ctx, actor, invite.spaceId);
      await revokeInvitation(asMutation(ctx), actor, membership, invite);
      return { revoked: true };
    },
  },
  {
    name: 'remove_member',
    title: 'Remove member',
    description: 'Removes someone from a space. Only works if the person this agent acts for owns the space. The owner cannot be removed.',
    scopes: ['spaces:manage'],
    write: true,
    inputSchema: { type: 'object', properties: { space_id: spaceIdProp, user_id: { type: 'string', description: 'A member’s user_id from list_members.' } }, required: ['space_id', 'user_id'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async run(ctx, actor, args) {
      only(args, ['space_id', 'user_id']);
      const id = spaceId(ctx, args);
      const userId = ctx.db.normalizeId('users', str(args, 'user_id', { max: 64 })!);
      if (!userId) throw new ConvexError('That person isn’t a member of this space.');
      const { membership } = await requireAgentSpace(ctx, actor, id);
      await removeMember(asMutation(ctx), actor, membership, userId);
      return { removed: true };
    },
  },
  {
    name: 'update_profile',
    title: 'Update profile',
    description: 'Changes the person’s display name or generated avatar. Photos can only be changed in the app.',
    scopes: ['profile:write'],
    write: true,
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1, maxLength: 40 }, avatar_seed: { type: 'string', minLength: 1, maxLength: 64, description: 'Any short string; picks a different generated avatar.' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(ctx, actor, args) {
      only(args, ['name', 'avatar_seed']);
      const name = str(args, 'name', { optional: true, max: 200 });
      const avatarSeed = str(args, 'avatar_seed', { optional: true, max: 64 });
      if (name === undefined && avatarSeed === undefined) throw new ConvexError('Pass a name or an avatar_seed.');
      const m = asMutation(ctx);
      await rateLimit(m, `profile:${actor.user._id}`, 30, 3_600_000);
      await updateProfile(m, actor.user, { name: name ?? (await person(ctx, actor.user._id)).name, avatarSeed });
      return { updated: true };
    },
  },
];

export const toolByName = (name: string) => TOOLS.find(t => t.name === name);
export const allowedFor = (tool: Tool, scopes: string[]) => tool.scopes === null || tool.scopes.some(s => scopes.includes(s));

async function invoke(ctx: QueryCtx | MutationCtx, tokenHash: string, name: string, args: Args, write: boolean) {
  const tool = toolByName(name);
  if (!tool || tool.write !== write) throw new ConvexError('Unknown tool.');
  const actor = await agentFromToken(ctx, tokenHash);
  if (tool.scopes && !tool.scopes.some(s => hasScope(actor, s))) requireScope(actor, tool.scopes[0]);
  return tool.run(ctx, actor, args);
}
export const read = internalQuery({ args: { tokenHash: v.string(), name: v.string(), args: v.any() }, handler: (ctx, { tokenHash, name, args }) => invoke(ctx, tokenHash, name, args, false) });
export const write = internalMutation({ args: { tokenHash: v.string(), name: v.string(), args: v.any() }, handler: (ctx, { tokenHash, name, args }) => invoke(ctx, tokenHash, name, args, true) });

/** Runs once per HTTP request: validates the token, applies the per-connection limit and records use. */
export const gate = internalMutation({ args: { tokenHash: v.string() }, handler: async (ctx, { tokenHash }) => {
  const actor = await agentFromToken(ctx, tokenHash);
  await rateLimit(ctx, `mcp:${actor.connection._id}`, 120, 60_000);
  const now = Date.now();
  if (!actor.connection.lastUsedAt || now - actor.connection.lastUsedAt > 60_000) await ctx.db.patch(actor.connection._id, { lastUsedAt: now });
  return { scopes: actor.connection.scopes };
}});
