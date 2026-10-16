import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { authTables } from '@convex-dev/auth/server';

export default defineSchema({
  ...authTables,
  profiles: defineTable({ userId: v.id('users'), name: v.string(), avatarSeed: v.string(), color: v.number(), imageId: v.optional(v.id('_storage')) }).index('by_user', ['userId']),
  spaces: defineTable({ name: v.string(), symbol: v.string(), color: v.number(), imageId: v.optional(v.id('_storage')), ownerId: v.id('users'), memberCount: v.number(), messageCount: v.number(), lastMessage: v.optional(v.string()), updatedAt: v.number() }),
  memberships: defineTable({ spaceId: v.id('spaces'), userId: v.id('users'), role: v.union(v.literal('owner'), v.literal('member')), color: v.optional(v.number()), lastReadSequence: v.number() }).index('by_user', ['userId']).index('by_space', ['spaceId']).index('by_space_user', ['spaceId', 'userId']),
  // Agent messages keep the person they act for as `senderId`, plus the connection and its name at the time.
  messages: defineTable({ spaceId: v.id('spaces'), senderId: v.id('users'), actorKind: v.union(v.literal('human'), v.literal('agent')), agentId: v.optional(v.id('agentConnections')), agentName: v.optional(v.string()), color: v.optional(v.number()), body: v.string(), clientId: v.string(), sequence: v.number() }).index('by_space', ['spaceId']).index('by_space_sequence', ['spaceId', 'sequence']).index('by_sender_client', ['senderId', 'clientId']).searchIndex('search_body', { searchField: 'body', filterFields: ['spaceId'] }),
  invitations: defineTable({ spaceId: v.id('spaces'), email: v.string(), inviterId: v.id('users'), expiresAt: v.number() }).index('by_email', ['email']).index('by_space', ['spaceId']).index('by_space_email', ['spaceId', 'email']),
  activities: defineTable({ spaceId: v.id('spaces'), actorId: v.id('users'), kind: v.union(v.literal('space_created'), v.literal('member_invited'), v.literal('member_joined'), v.literal('member_removed'), v.literal('invite_revoked'), v.literal('space_updated')), subject: v.optional(v.string()), agentName: v.optional(v.string()) }).index('by_space', ['spaceId']),
  // Who is typing in a space right now; rows refresh while someone types and are ignored once expired.
  typing: defineTable({ spaceId: v.id('spaces'), userId: v.id('users'), expiresAt: v.number() }).index('by_space', ['spaceId']).index('by_space_user', ['spaceId', 'userId']),
  // Agent access. A connection is one grant (deleted when revoked) from a person to one agent: what it may do and where.
  // Every MCP call re-checks the grant, the person's live membership and role, in the same transaction.
  agentConnections: defineTable({
    userId: v.id('users'),
    name: v.string(),
    kind: v.union(v.literal('oauth'), v.literal('token')),
    clientId: v.optional(v.string()),
    clientName: v.optional(v.string()),
    redirectHost: v.optional(v.string()),
    scopes: v.array(v.string()),
    // The most an OAuth client asked for; the person can grant less, and never more, later too.
    requestedScopes: v.optional(v.array(v.string())),
    spaceMode: v.union(v.literal('all'), v.literal('selected')),
    spaceIds: v.array(v.id('spaces')),
    // OAuth grants stay pending until their authorization code is exchanged.
    pending: v.optional(v.boolean()),
    lastUsedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  }).index('by_user', ['userId']),
  // Only SHA-256 hashes of secrets are stored. `replacedAt` marks a refresh token that has been rotated.
  agentTokens: defineTable({ connectionId: v.id('agentConnections'), hash: v.string(), kind: v.union(v.literal('access'), v.literal('refresh'), v.literal('personal')), expiresAt: v.optional(v.number()), replacedAt: v.optional(v.number()) }).index('by_hash', ['hash']).index('by_connection', ['connectionId']),
  // Where each connection last caught up in a space (catch_up). Private to the connection: it never moves the person's read marker.
  agentCheckpoints: defineTable({ connectionId: v.id('agentConnections'), spaceId: v.id('spaces'), sequence: v.number() }).index('by_connection_space', ['connectionId', 'spaceId']),
  oauthClients: defineTable({ clientId: v.string(), name: v.string(), redirectUris: v.array(v.string()) }).index('by_client', ['clientId']),
  // A pending browser authorization, between /oauth/authorize and the person's decision.
  oauthRequests: defineTable({ requestId: v.string(), clientId: v.string(), redirectUri: v.string(), codeChallenge: v.string(), state: v.optional(v.string()), scopes: v.array(v.string()), resource: v.string(), expiresAt: v.number() }).index('by_request', ['requestId']).index('by_expiry', ['expiresAt']),
  oauthCodes: defineTable({ hash: v.string(), connectionId: v.id('agentConnections'), clientId: v.string(), redirectUri: v.string(), codeChallenge: v.string(), resource: v.string(), expiresAt: v.number(), usedAt: v.optional(v.number()) }).index('by_hash', ['hash']).index('by_expiry', ['expiresAt']),
  rateLimits: defineTable({ key: v.string(), start: v.number(), count: v.number() }).index('by_key', ['key']),
});
