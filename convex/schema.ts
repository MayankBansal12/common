import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { authTables } from '@convex-dev/auth/server';

export default defineSchema({
  ...authTables,
  profiles: defineTable({ userId: v.id('users'), name: v.string(), avatarSeed: v.string(), color: v.number(), imageId: v.optional(v.id('_storage')) }).index('by_user', ['userId']),
  spaces: defineTable({ name: v.string(), symbol: v.string(), color: v.number(), imageId: v.optional(v.id('_storage')), ownerId: v.id('users'), memberCount: v.number(), messageCount: v.number(), lastMessage: v.optional(v.string()), updatedAt: v.number() }),
  memberships: defineTable({ spaceId: v.id('spaces'), userId: v.id('users'), role: v.union(v.literal('owner'), v.literal('member')), color: v.optional(v.number()), lastReadSequence: v.number() }).index('by_user', ['userId']).index('by_space', ['spaceId']).index('by_space_user', ['spaceId', 'userId']),
  messages: defineTable({ spaceId: v.id('spaces'), senderId: v.id('users'), actorKind: v.literal('human'), color: v.optional(v.number()), body: v.string(), clientId: v.string(), sequence: v.number() }).index('by_space', ['spaceId']).index('by_sender_client', ['senderId', 'clientId']),
  invitations: defineTable({ spaceId: v.id('spaces'), email: v.string(), inviterId: v.id('users'), expiresAt: v.number() }).index('by_email', ['email']).index('by_space', ['spaceId']).index('by_space_email', ['spaceId', 'email']),
  activities: defineTable({ spaceId: v.id('spaces'), actorId: v.id('users'), kind: v.union(v.literal('space_created'), v.literal('member_invited'), v.literal('member_joined'), v.literal('member_removed'), v.literal('invite_revoked'), v.literal('space_updated')), subject: v.optional(v.string()) }).index('by_space', ['spaceId']),
  rateLimits: defineTable({ key: v.string(), start: v.number(), count: v.number() }).index('by_key', ['key']),
});
