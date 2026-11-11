import * as v from 'valibot';
import { APP_CONFIG } from './constants';

const trimmed = (min: number, max: number) =>
  v.pipe(v.string(), v.trim(), v.minLength(min), v.maxLength(max));

export const idSchema = v.pipe(
  v.string(),
  v.regex(/^[a-z][a-z0-9]*_[0-9a-f-]{16,}$/i, 'Invalid identifier'),
);
export const cursorSchema = v.optional(v.pipe(v.string(), v.maxLength(512)));
export const paginationSchema = v.object({
  cursor: cursorSchema,
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)), 30),
});

export const usernameSchema = v.pipe(
  v.string(),
  v.trim(),
  v.toLowerCase(),
  v.minLength(3),
  v.maxLength(24),
  v.regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers, or underscores'),
);

export const passwordSchema = v.pipe(
  v.string(),
  v.minLength(12, 'Use at least 12 characters'),
  v.maxLength(128),
  v.regex(/[a-z]/, 'Add a lowercase letter'),
  v.regex(/[A-Z]/, 'Add an uppercase letter'),
  v.regex(/[0-9]/, 'Add a number'),
);

export const registerSchema = v.object({
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email(), v.maxLength(254)),
  username: usernameSchema,
  displayName: trimmed(1, 50),
  password: passwordSchema,
  birthDate: v.pipe(v.string(), v.isoDate('Use YYYY-MM-DD')),
  acceptTerms: v.literal(true, 'Terms must be accepted'),
});

export const loginSchema = v.object({
  identifier: trimmed(3, 254),
  password: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  totp: v.optional(v.pipe(v.string(), v.regex(/^\d{6}$/))),
});

export const profileSchema = v.object({
  displayName: v.optional(trimmed(1, 50)),
  bio: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(APP_CONFIG.maxBioLength))),
  status: v.optional(v.picklist(['online', 'idle', 'dnd', 'invisible'])),
  locale: v.optional(v.picklist(['en', 'ar'])),
  avatarKey: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(200)))),
});

export const postSchema = v.object({
  body: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(APP_CONFIG.maxPostLength)),
  visibility: v.optional(v.picklist(['public', 'followers', 'friends']), 'public'),
  mediaKeys: v.optional(v.pipe(v.array(v.pipe(v.string(), v.maxLength(200))), v.maxLength(4)), []),
});

export const commentSchema = v.object({
  body: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2_000)),
  parentId: v.optional(v.nullable(idSchema)),
});

export const messageSchema = v.object({
  content: v.pipe(v.string(), v.trim(), v.maxLength(APP_CONFIG.maxMessageLength)),
  clientNonce: v.pipe(v.string(), v.minLength(8), v.maxLength(80)),
  replyTo: v.optional(v.nullable(idSchema)),
  threadId: v.optional(v.nullable(idSchema)),
  attachmentKeys: v.optional(
    v.pipe(v.array(v.pipe(v.string(), v.maxLength(200))), v.maxLength(10)),
    [],
  ),
});

export const serverSchema = v.object({
  name: trimmed(2, APP_CONFIG.maxCommunityName),
  description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500)), ''),
  visibility: v.optional(v.picklist(['private', 'public']), 'private'),
});

export const channelSchema = v.object({
  name: v.pipe(
    v.string(),
    v.trim(),
    v.toLowerCase(),
    v.minLength(1),
    v.maxLength(80),
    v.regex(/^[\p{L}\p{N}_-]+$/u),
  ),
  type: v.picklist(['text', 'voice', 'announcement']),
  topic: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1_024)), ''),
  categoryId: v.optional(v.nullable(idSchema)),
});

export const roleSchema = v.object({
  name: trimmed(1, 80),
  color: v.optional(v.pipe(v.string(), v.regex(/^#[0-9a-f]{6}$/i)), '#8b5cf6'),
  permissions: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

export const inviteSchema = v.object({
  channelId: v.optional(v.nullable(idSchema)),
  expiresInSeconds: v.optional(
    v.nullable(v.pipe(v.number(), v.integer(), v.minValue(300), v.maxValue(2_592_000))),
    86_400,
  ),
  maxUses: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10_000)), 0),
});

export const reportSchema = v.object({
  targetType: v.picklist(['user', 'post', 'message', 'server']),
  targetId: idSchema,
  reason: v.picklist([
    'spam',
    'harassment',
    'hate',
    'violence',
    'sexual',
    'impersonation',
    'other',
  ]),
  details: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1_000)), ''),
});

export const searchSchema = v.object({
  query: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(100)),
  type: v.optional(v.picklist(['all', 'users', 'posts', 'servers']), 'all'),
});

export type RegisterInput = v.InferOutput<typeof registerSchema>;
export type LoginInput = v.InferOutput<typeof loginSchema>;
export type ProfileInput = v.InferOutput<typeof profileSchema>;
export type PostInput = v.InferOutput<typeof postSchema>;
export type MessageInput = v.InferOutput<typeof messageSchema>;
export type ServerInput = v.InferOutput<typeof serverSchema>;
export type ChannelInput = v.InferOutput<typeof channelSchema>;
export type RoleInput = v.InferOutput<typeof roleSchema>;
