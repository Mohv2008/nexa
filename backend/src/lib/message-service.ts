import { Permission, cleanText, messageSchema, newId, type MessageInput } from '@nexa/shared';
import * as v from 'valibot';
import { ApiError } from './errors';
import { requireConversationMember, requireServerPermission } from './permissions';

export interface MessageTarget {
  kind: 'channel' | 'conversation';
  id: string;
}

export interface CreatedMessage {
  id: string;
  createdAt: string;
  duplicate: boolean;
  target: MessageTarget;
}

interface ChannelContext {
  server_id: string;
  type: 'text' | 'voice' | 'announcement';
  slow_mode_seconds: number;
  automod_json: string;
}

interface AutoMod {
  maxMessages: number;
  windowSeconds: number;
  blockLinks: boolean;
  bannedWords: string[];
}

function parseAutoMod(value: string): AutoMod {
  try {
    const parsed = JSON.parse(value) as Partial<AutoMod>;
    return {
      maxMessages: Number.isInteger(parsed.maxMessages) ? Number(parsed.maxMessages) : 8,
      windowSeconds: Number.isInteger(parsed.windowSeconds) ? Number(parsed.windowSeconds) : 10,
      blockLinks: parsed.blockLinks === true,
      bannedWords: Array.isArray(parsed.bannedWords)
        ? parsed.bannedWords.filter((word): word is string => typeof word === 'string').slice(0, 50)
        : [],
    };
  } catch {
    return { maxMessages: 8, windowSeconds: 10, blockLinks: false, bannedWords: [] };
  }
}

export function validateMessageInput(input: unknown): MessageInput {
  const parsed = v.safeParse(messageSchema, input);
  if (!parsed.success) throw new ApiError('validation_failed', 'Message is invalid.', 400);
  if (!parsed.output.content && parsed.output.attachmentKeys.length === 0) {
    throw new ApiError('empty_message', 'A message needs text or an attachment.', 400);
  }
  return { ...parsed.output, content: cleanText(parsed.output.content) };
}

export async function authorizeMessageTarget(
  database: D1Database,
  userId: string,
  target: MessageTarget,
  permission = Permission.VIEW_CHANNEL,
): Promise<{ serverId: string | null; mutedUntil: number | null }> {
  if (target.kind === 'conversation') {
    await requireConversationMember(database, userId, target.id);
    return { serverId: null, mutedUntil: null };
  }
  const channel = await database
    .prepare('SELECT server_id FROM channels WHERE id = ?')
    .bind(target.id)
    .first<{ server_id: string }>();
  if (!channel) throw new ApiError('not_found', 'Channel not found.', 404);
  const result = await requireServerPermission(
    database,
    userId,
    channel.server_id,
    permission,
    target.id,
  );
  return { serverId: channel.server_id, mutedUntil: result.mutedUntil };
}

export async function createMessage(
  database: D1Database,
  userId: string,
  target: MessageTarget,
  unknownInput: unknown,
  now = Date.now(),
): Promise<CreatedMessage> {
  const input = validateMessageInput(unknownInput);
  let channelContext: ChannelContext | null = null;
  if (target.kind === 'channel') {
    channelContext = await database
      .prepare(
        `SELECT c.server_id, c.type, c.slow_mode_seconds, s.automod_json
           FROM channels c JOIN servers s ON s.id = c.server_id WHERE c.id = ?`,
      )
      .bind(target.id)
      .first<ChannelContext>();
    if (!channelContext || channelContext.type === 'voice') {
      throw new ApiError('invalid_channel', 'Messages cannot be sent to this channel.', 400);
    }
    const permissions = await requireServerPermission(
      database,
      userId,
      channelContext.server_id,
      Permission.SEND_MESSAGES,
      target.id,
    );
    const nowSeconds = Math.floor(now / 1000);
    if (permissions.mutedUntil !== null && permissions.mutedUntil > nowSeconds) {
      throw new ApiError('muted', 'You are muted in this community.', 403);
    }
    if (
      channelContext.type === 'announcement' &&
      (permissions.mask & Permission.MANAGE_MESSAGES) === 0
    ) {
      throw new ApiError('missing_permission', 'Only moderators can post announcements.', 403);
    }
    if (
      channelContext.slow_mode_seconds > 0 &&
      (permissions.mask & Permission.MANAGE_MESSAGES) === 0
    ) {
      const latest = await database
        .prepare(
          `SELECT unixepoch(created_at) AS sent_at FROM messages
            WHERE channel_id = ? AND author_id = ? AND deleted_at IS NULL
            ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(target.id, userId)
        .first<{ sent_at: number }>();
      if (latest && latest.sent_at + channelContext.slow_mode_seconds > nowSeconds) {
        throw new ApiError('slow_mode', 'Slow mode is active. Wait before sending again.', 429, {
          retryAfter: latest.sent_at + channelContext.slow_mode_seconds - nowSeconds,
        });
      }
    }
    const autoMod = parseAutoMod(channelContext.automod_json);
    const normalized = input.content.toLocaleLowerCase();
    if (autoMod.blockLinks && /(?:https?:\/\/|www\.)/iu.test(input.content)) {
      throw new ApiError('automod_blocked', 'Links are not allowed in this community.', 400);
    }
    if (autoMod.bannedWords.some((word) => normalized.includes(word))) {
      throw new ApiError(
        'automod_blocked',
        'This message was blocked by community moderation.',
        400,
      );
    }
    const recent = await database
      .prepare(
        `SELECT count(*) AS total FROM messages
          WHERE channel_id = ? AND author_id = ? AND unixepoch(created_at) >= ?`,
      )
      .bind(target.id, userId, nowSeconds - autoMod.windowSeconds)
      .first<{ total: number }>();
    if ((recent?.total ?? 0) >= autoMod.maxMessages) {
      throw new ApiError('automod_rate', 'You are sending messages too quickly.', 429);
    }
  } else {
    await requireConversationMember(database, userId, target.id);
  }

  let attachments: Array<{ id: string; object_key: string }> = [];
  if (input.attachmentKeys.length > 0) {
    const placeholders = input.attachmentKeys.map(() => '?').join(',');
    const results = await database
      .prepare(
        `SELECT id, object_key FROM uploads WHERE owner_id = ? AND object_key IN (${placeholders})`,
      )
      .bind(userId, ...input.attachmentKeys)
      .all<{ id: string; object_key: string }>();
    attachments = results.results;
    if (attachments.length !== input.attachmentKeys.length) {
      throw new ApiError('invalid_upload', 'One or more attachments were not found.', 400);
    }
  }

  if (input.replyTo || input.threadId) {
    for (const reference of [input.replyTo, input.threadId].filter(Boolean) as string[]) {
      const referenced = await database
        .prepare(
          `SELECT 1 AS found FROM messages WHERE id = ?
            AND ((? = 'channel' AND channel_id = ?) OR (? = 'conversation' AND conversation_id = ?))`,
        )
        .bind(reference, target.kind, target.id, target.kind, target.id)
        .first();
      if (!referenced)
        throw new ApiError('invalid_reference', 'Referenced message was not found.', 400);
    }
  }

  const existing = await database
    .prepare('SELECT id, created_at FROM messages WHERE author_id = ? AND client_nonce = ?')
    .bind(userId, input.clientNonce)
    .first<{ id: string; created_at: string }>();
  if (existing) {
    return { id: existing.id, createdAt: existing.created_at, duplicate: true, target };
  }

  const messageId = newId('msg');
  const statements = [
    database
      .prepare(
        `INSERT INTO messages
          (id, channel_id, conversation_id, author_id, content, client_nonce, reply_to_id, thread_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        messageId,
        target.kind === 'channel' ? target.id : null,
        target.kind === 'conversation' ? target.id : null,
        userId,
        input.content,
        input.clientNonce,
        input.replyTo ?? null,
        input.threadId ?? null,
      ),
    ...input.attachmentKeys.map((key, position) => {
      const attachment = attachments.find((candidate) => candidate.object_key === key)!;
      return database
        .prepare(
          'INSERT INTO message_attachments (message_id, upload_id, position) VALUES (?, ?, ?)',
        )
        .bind(messageId, attachment.id, position);
    }),
  ];
  try {
    await database.batch(statements);
  } catch (error) {
    const duplicate = await database
      .prepare('SELECT id, created_at FROM messages WHERE author_id = ? AND client_nonce = ?')
      .bind(userId, input.clientNonce)
      .first<{ id: string; created_at: string }>();
    if (duplicate) {
      return { id: duplicate.id, createdAt: duplicate.created_at, duplicate: true, target };
    }
    throw error;
  }
  const created = await database
    .prepare('SELECT created_at FROM messages WHERE id = ?')
    .bind(messageId)
    .first<{ created_at: string }>();
  return {
    id: messageId,
    createdAt: created?.created_at ?? new Date(now).toISOString(),
    duplicate: false,
    target,
  };
}
