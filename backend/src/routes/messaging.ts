import { decodeCursor, encodeCursor, idSchema, newId } from '@nexa/shared';
import { Hono, type Context } from 'hono';
import * as v from 'valibot';
import type { AppEnv } from '../env';
import { authenticate, publicUser, requireCsrf } from '../lib/auth';
import { ApiError } from '../lib/errors';
import { sendAndroidPush } from '../lib/fcm';
import { authorizeMessageTarget, createMessage, type MessageTarget } from '../lib/message-service';
import { createNotification, notifyMentionedUsers } from '../lib/notifications';
import { Permission } from '@nexa/shared';
import { requireConversationMember, requireServerPermission } from '../lib/permissions';
import { enforceRateLimit } from '../lib/rate-limit';
import { broadcastRoom } from '../lib/realtime';
import { boundedInteger, parseJson } from '../lib/validation';

const messaging = new Hono<AppEnv>();

interface MessageRow {
  id: string;
  channel_id: string | null;
  conversation_id: string | null;
  content: string;
  client_nonce: string;
  reply_to_id: string | null;
  thread_id: string | null;
  forwarded_from_id: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  author_id: string;
  username: string;
  display_name: string;
  avatar_key: string | null;
  status: string;
  attachments_json: string;
  reactions_json: string;
}

interface MessageAccessRow {
  id: string;
  author_id: string;
  channel_id: string | null;
  conversation_id: string | null;
  server_id: string | null;
  content: string;
  deleted_at: string | null;
}

const conversationSchema = v.object({
  memberIds: v.pipe(v.array(idSchema), v.minLength(1), v.maxLength(49)),
  name: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(80))),
});
const editSchema = v.object({
  content: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(4_000)),
});
const reactionSchema = v.object({
  emoji: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(32)),
});
const forwardSchema = v.object({
  targetType: v.picklist(['channel', 'conversation']),
  targetId: idSchema,
  clientNonce: v.pipe(v.string(), v.minLength(8), v.maxLength(80)),
});
const memberSchema = v.object({ userId: idSchema });
const pushSchema = v.object({
  endpoint: v.pipe(v.string(), v.url(), v.maxLength(2_048)),
  keys: v.object({
    p256dh: v.pipe(v.string(), v.minLength(20), v.maxLength(200)),
    auth: v.pipe(v.string(), v.minLength(8), v.maxLength(100)),
  }),
  platform: v.picklist(['web', 'android']),
});
const deviceTokenSchema = v.object({
  token: v.pipe(v.string(), v.trim(), v.minLength(32), v.maxLength(4_096)),
  platform: v.literal('android'),
});

const messageSelect = `
  SELECT m.id, m.channel_id, m.conversation_id, m.content, m.client_nonce,
         m.reply_to_id, m.thread_id, m.forwarded_from_id, m.created_at, m.edited_at, m.deleted_at,
         u.id AS author_id, u.username, u.display_name, u.avatar_key, u.status,
         COALESCE((
           SELECT json_group_array(json_object(
             'id', up.id, 'key', up.object_key, 'name', up.original_name,
             'mime', up.mime_type, 'size', up.byte_size,
             'width', up.width, 'height', up.height, 'durationMs', up.duration_ms
           )) FROM message_attachments ma JOIN uploads up ON up.id = ma.upload_id
           WHERE ma.message_id = m.id ORDER BY ma.position
         ), '[]') AS attachments_json,
         COALESCE((
           SELECT json_group_array(json_object(
             'emoji', grouped.emoji, 'count', grouped.total, 'reacted', grouped.reacted
           )) FROM (
             SELECT emoji, count(*) AS total,
                    max(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS reacted
               FROM message_reactions WHERE message_id = m.id GROUP BY emoji
           ) grouped
         ), '[]') AS reactions_json
    FROM messages m JOIN users u ON u.id = m.author_id`;

function parseArray(value: string): Array<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function mapMessage(row: MessageRow) {
  return {
    id: row.id,
    channelId: row.channel_id,
    conversationId: row.conversation_id,
    author: publicUser({
      id: row.author_id,
      username: row.username,
      display_name: row.display_name,
      avatar_key: row.avatar_key,
      status: row.status,
    }),
    content: row.deleted_at ? '' : row.content,
    clientNonce: row.client_nonce,
    replyTo: row.reply_to_id,
    threadId: row.thread_id,
    forwardedFrom: row.forwarded_from_id,
    attachments: row.deleted_at
      ? []
      : parseArray(row.attachments_json).map((attachment) => ({
          ...attachment,
          url: `/v1/media/${encodeURIComponent(String(attachment.key ?? ''))}`,
        })),
    reactions: row.deleted_at
      ? []
      : parseArray(row.reactions_json).map((reaction) => ({
          emoji: String(reaction.emoji ?? ''),
          count: Number(reaction.count ?? 0),
          reacted: Number(reaction.reacted ?? 0) === 1,
        })),
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
  };
}

async function fetchMessage(database: D1Database, messageId: string, viewerId: string) {
  const row = await database
    .prepare(`${messageSelect} WHERE m.id = ?`)
    .bind(viewerId, messageId)
    .first<MessageRow>();
  return row ? mapMessage(row) : null;
}

async function messageAccess(
  database: D1Database,
  messageId: string,
): Promise<MessageAccessRow | null> {
  return database
    .prepare(
      `SELECT m.id, m.author_id, m.channel_id, m.conversation_id, m.content, m.deleted_at,
              c.server_id
         FROM messages m LEFT JOIN channels c ON c.id = m.channel_id WHERE m.id = ?`,
    )
    .bind(messageId)
    .first<MessageAccessRow>();
}

async function requireMessageAccess(
  database: D1Database,
  userId: string,
  row: MessageAccessRow,
): Promise<MessageTarget> {
  if (row.channel_id && row.server_id) {
    await requireServerPermission(
      database,
      userId,
      row.server_id,
      Permission.VIEW_CHANNEL,
      row.channel_id,
    );
    return { kind: 'channel', id: row.channel_id };
  }
  if (row.conversation_id) {
    await requireConversationMember(database, userId, row.conversation_id);
    return { kind: 'conversation', id: row.conversation_id };
  }
  throw new ApiError('not_found', 'Message not found.', 404);
}

async function emitMessageCreated(
  context: Context<AppEnv>,
  target: MessageTarget,
  messageId: string,
): Promise<void> {
  const userId = context.get('user').id;
  const message = await fetchMessage(context.env.DB, messageId, userId);
  if (!message) return;
  const tasks: Promise<unknown>[] = [
    broadcastRoom(context.env, `${target.kind}:${target.id}`, {
      type: 'message.created',
      data: message,
    }),
  ];
  if (!message.deletedAt) {
    tasks.push(
      notifyMentionedUsers(context.env.DB, message.content, userId, 'message_mention', messageId),
    );
  }
  if (target.kind === 'conversation') {
    const members = await context.env.DB.prepare(
      'SELECT user_id FROM conversation_members WHERE conversation_id = ? AND left_at IS NULL AND user_id <> ?',
    )
      .bind(target.id, userId)
      .all<{ user_id: string }>();
    for (const member of members.results) {
      tasks.push(
        createNotification(context.env.DB, member.user_id, userId, 'direct_message', messageId, {
          conversationId: target.id,
        }),
      );
      tasks.push(
        sendAndroidPush(
          context.env,
          member.user_id,
          'New NEXA message',
          message.content.slice(0, 120),
          {
            type: 'direct_message',
            entityId: messageId,
            conversationId: target.id,
          },
        ),
      );
    }
  }
  await Promise.all(tasks);
}

messaging.get('/conversations', authenticate, async (context) => {
  const userId = context.get('user').id;
  const rows = await context.env.DB.prepare(
    `SELECT c.id, c.type, c.name, c.owner_id, c.created_at, c.updated_at,
            COALESCE((SELECT json_group_array(json_object(
              'id', u.id, 'username', u.username, 'displayName', u.display_name,
              'avatarKey', u.avatar_key, 'status', u.status, 'role', member.role
            )) FROM conversation_members member JOIN users u ON u.id = member.user_id
              WHERE member.conversation_id = c.id AND member.left_at IS NULL), '[]') AS members_json,
            (SELECT m.content FROM messages m WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC LIMIT 1) AS last_message,
            (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
            (SELECT count(*) FROM messages unread
              WHERE unread.conversation_id = c.id AND unread.author_id <> ?
                AND unread.created_at > COALESCE((
                  SELECT marker.created_at FROM conversation_members self
                    LEFT JOIN messages marker ON marker.id = self.last_read_message_id
                   WHERE self.conversation_id = c.id AND self.user_id = ?
                ), '1970-01-01')) AS unread_count
       FROM conversations c JOIN conversation_members mine ON mine.conversation_id = c.id
      WHERE mine.user_id = ? AND mine.left_at IS NULL
      ORDER BY COALESCE(last_message_at, c.updated_at) DESC LIMIT 100`,
  )
    .bind(userId, userId, userId)
    .all<{
      id: string;
      type: string;
      name: string | null;
      owner_id: string | null;
      created_at: string;
      updated_at: string;
      members_json: string;
      last_message: string | null;
      last_message_at: string | null;
      unread_count: number;
    }>();
  return context.json({
    data: rows.results.map((row) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      ownerId: row.owner_id,
      members: parseArray(row.members_json).map((member) => ({
        id: member.id,
        username: member.username,
        displayName: member.displayName,
        avatarUrl: member.avatarKey
          ? `/v1/media/${encodeURIComponent(String(member.avatarKey))}`
          : null,
        status: member.status === 'invisible' ? 'offline' : member.status,
        role: member.role,
      })),
      lastMessage: row.last_message,
      lastMessageAt: row.last_message_at,
      unreadCount: row.unread_count,
      createdAt: row.created_at,
    })),
  });
});

messaging.post('/conversations', authenticate, requireCsrf, async (context) => {
  const creatorId = context.get('user').id;
  await enforceRateLimit(context, 'create-conversation', creatorId, 20, 60 * 60);
  const input = await parseJson(context, conversationSchema);
  const uniqueMemberIds = [...new Set(input.memberIds)].filter((id) => id !== creatorId);
  if (uniqueMemberIds.length === 0) {
    throw new ApiError('invalid_members', 'Choose at least one other member.', 400);
  }
  const placeholders = uniqueMemberIds.map(() => '?').join(',');
  const users = await context.env.DB.prepare(
    `SELECT id, privacy_json FROM users WHERE id IN (${placeholders}) AND deletion_requested_at IS NULL`,
  )
    .bind(...uniqueMemberIds)
    .all<{ id: string; privacy_json: string }>();
  if (users.results.length !== uniqueMemberIds.length) {
    throw new ApiError('invalid_members', 'One or more users were not found.', 400);
  }
  const blocked = await context.env.DB.prepare(
    `SELECT 1 AS blocked FROM blocks WHERE
      (blocker_id = ? AND blocked_id IN (${placeholders})) OR
      (blocked_id = ? AND blocker_id IN (${placeholders})) LIMIT 1`,
  )
    .bind(creatorId, ...uniqueMemberIds, creatorId, ...uniqueMemberIds)
    .first();
  if (blocked) throw new ApiError('invalid_members', 'This conversation cannot be created.', 403);

  const direct = uniqueMemberIds.length === 1 && !input.name;
  if (direct) {
    const target = users.results[0]!;
    const privacy = JSON.parse(target.privacy_json) as { dmFrom?: string };
    if (privacy.dmFrom === 'none') {
      throw new ApiError('dm_closed', 'This user is not accepting direct messages.', 403);
    }
    if (privacy.dmFrom === 'friends') {
      const friend = await context.env.DB.prepare(
        `SELECT 1 AS friend FROM follows a JOIN follows b
          ON b.follower_id = a.following_id AND b.following_id = a.follower_id
         WHERE a.follower_id = ? AND a.following_id = ?
           AND a.status = 'accepted' AND b.status = 'accepted'`,
      )
        .bind(creatorId, target.id)
        .first();
      if (!friend) throw new ApiError('dm_closed', 'Only friends can message this user.', 403);
    }
    const existing = await context.env.DB.prepare(
      `SELECT c.id FROM conversations c
        WHERE c.type = 'direct'
          AND EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = c.id AND user_id = ? AND left_at IS NULL)
          AND EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = c.id AND user_id = ? AND left_at IS NULL)
          AND (SELECT count(*) FROM conversation_members WHERE conversation_id = c.id AND left_at IS NULL) = 2
        LIMIT 1`,
    )
      .bind(creatorId, target.id)
      .first<{ id: string }>();
    if (existing) return context.json({ data: { id: existing.id, existing: true } });
  }

  const conversationId = newId('cnv');
  const type = direct ? 'direct' : 'group';
  await context.env.DB.batch([
    context.env.DB.prepare(
      'INSERT INTO conversations (id, type, name, owner_id) VALUES (?, ?, ?, ?)',
    ).bind(conversationId, type, input.name ?? null, type === 'group' ? creatorId : null),
    context.env.DB.prepare(
      "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'owner')",
    ).bind(conversationId, creatorId),
    ...uniqueMemberIds.map((memberId) =>
      context.env.DB.prepare(
        "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'member')",
      ).bind(conversationId, memberId),
    ),
  ]);
  for (const memberId of uniqueMemberIds) {
    context.executionCtx.waitUntil(
      createNotification(context.env.DB, memberId, creatorId, 'conversation_added', conversationId),
    );
  }
  return context.json({ data: { id: conversationId, type, existing: false } }, 201);
});

messaging.post(
  '/conversations/:conversationId/members',
  authenticate,
  requireCsrf,
  async (context) => {
    const conversationId = context.req.param('conversationId');
    const input = await parseJson(context, memberSchema);
    const role = await context.env.DB.prepare(
      `SELECT cm.role, c.type FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.conversation_id = ? AND cm.user_id = ? AND cm.left_at IS NULL`,
    )
      .bind(conversationId, context.get('user').id)
      .first<{ role: string; type: string }>();
    if (!role || role.type !== 'group' || !['owner', 'admin'].includes(role.role)) {
      throw new ApiError('forbidden', 'Only group admins can add members.', 403);
    }
    await context.env.DB.prepare(
      `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'member')
     ON CONFLICT(conversation_id, user_id) DO UPDATE SET left_at = NULL, role = 'member'`,
    )
      .bind(conversationId, input.userId)
      .run();
    return context.json({ data: { added: true } });
  },
);

messaging.delete(
  '/conversations/:conversationId/members/:userId',
  authenticate,
  requireCsrf,
  async (context) => {
    const conversationId = context.req.param('conversationId');
    const actorId = context.get('user').id;
    const targetId = context.req.param('userId');
    const actor = await context.env.DB.prepare(
      'SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL',
    )
      .bind(conversationId, actorId)
      .first<{ role: string }>();
    if (targetId !== actorId && (!actor || !['owner', 'admin'].includes(actor.role))) {
      throw new ApiError('forbidden', 'Only group admins can remove members.', 403);
    }
    await context.env.DB.prepare(
      `UPDATE conversation_members SET left_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE conversation_id = ? AND user_id = ?`,
    )
      .bind(conversationId, targetId)
      .run();
    return context.body(null, 204);
  },
);

async function listMessages(context: Context<AppEnv>, target: MessageTarget) {
  const userId = context.get('user').id;
  await authorizeMessageTarget(context.env.DB, userId, target);
  const limit = boundedInteger(context.req.query('limit'), 50, 1, 100);
  const cursorValue = context.req.query('cursor');
  const cursor = cursorValue ? decodeCursor<{ createdAt: string; id: string }>(cursorValue) : null;
  const targetColumn = target.kind === 'channel' ? 'm.channel_id' : 'm.conversation_id';
  const cursorSql = cursor ? 'AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))' : '';
  const parameters: unknown[] = [userId, target.id];
  if (cursor) parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
  parameters.push(limit + 1);
  const rows = await context.env.DB.prepare(
    `${messageSelect} WHERE ${targetColumn} = ? ${cursorSql}
      ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
  )
    .bind(...parameters)
    .all<MessageRow>();
  const hasMore = rows.results.length > limit;
  const page = rows.results.slice(0, limit);
  const last = page.at(-1);
  return context.json({
    data: {
      items: page.reverse().map(mapMessage),
      nextCursor:
        hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
    },
  });
}

messaging.get('/channels/:channelId/messages', authenticate, (context) =>
  listMessages(context, { kind: 'channel', id: context.req.param('channelId') }),
);

messaging.get('/conversations/:conversationId/messages', authenticate, (context) =>
  listMessages(context, { kind: 'conversation', id: context.req.param('conversationId') }),
);

async function sendMessage(context: Context<AppEnv>, target: MessageTarget) {
  const userId = context.get('user').id;
  await enforceRateLimit(context, 'message', userId, 240, 60);
  const contentType = context.req.header('Content-Type')?.split(';')[0];
  if (contentType !== 'application/json') {
    throw new ApiError('unsupported_media_type', 'Content-Type must be application/json.', 415);
  }
  let input: unknown;
  try {
    input = await context.req.json();
  } catch {
    throw new ApiError('invalid_json', 'Message body is invalid.', 400);
  }
  const created = await createMessage(context.env.DB, userId, target, input);
  if (!created.duplicate)
    context.executionCtx.waitUntil(emitMessageCreated(context, target, created.id));
  const message = await fetchMessage(context.env.DB, created.id, userId);
  return context.json(
    { data: message, duplicate: created.duplicate },
    created.duplicate ? 200 : 201,
  );
}

messaging.post('/channels/:channelId/messages', authenticate, requireCsrf, (context) =>
  sendMessage(context, { kind: 'channel', id: context.req.param('channelId') }),
);

messaging.post('/conversations/:conversationId/messages', authenticate, requireCsrf, (context) =>
  sendMessage(context, { kind: 'conversation', id: context.req.param('conversationId') }),
);

messaging.get('/messages/:messageId/thread', authenticate, async (context) => {
  const root = await messageAccess(context.env.DB, context.req.param('messageId'));
  if (!root) throw new ApiError('not_found', 'Message not found.', 404);
  await requireMessageAccess(context.env.DB, context.get('user').id, root);
  const rows = await context.env.DB.prepare(
    `${messageSelect} WHERE m.thread_id = ? ORDER BY m.created_at ASC LIMIT 500`,
  )
    .bind(context.get('user').id, root.id)
    .all<MessageRow>();
  return context.json({ data: rows.results.map(mapMessage) });
});

messaging.patch('/messages/:messageId', authenticate, requireCsrf, async (context) => {
  const input = await parseJson(context, editSchema);
  const userId = context.get('user').id;
  const row = await messageAccess(context.env.DB, context.req.param('messageId'));
  if (!row || row.deleted_at) throw new ApiError('not_found', 'Message not found.', 404);
  const target = await requireMessageAccess(context.env.DB, userId, row);
  if (row.author_id !== userId) {
    throw new ApiError('forbidden', 'Only the author can edit this message.', 403);
  }
  await context.env.DB.prepare(
    `UPDATE messages SET content = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`,
  )
    .bind(input.content, row.id)
    .run();
  const message = await fetchMessage(context.env.DB, row.id, userId);
  context.executionCtx.waitUntil(
    broadcastRoom(context.env, `${target.kind}:${target.id}`, {
      type: 'message.updated',
      data: message,
    }),
  );
  return context.json({ data: message });
});

messaging.delete('/messages/:messageId', authenticate, requireCsrf, async (context) => {
  const userId = context.get('user').id;
  const row = await messageAccess(context.env.DB, context.req.param('messageId'));
  if (!row || row.deleted_at) throw new ApiError('not_found', 'Message not found.', 404);
  const target = await requireMessageAccess(context.env.DB, userId, row);
  if (row.author_id !== userId) {
    if (!row.channel_id || !row.server_id) {
      const member = await context.env.DB.prepare(
        `SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL`,
      )
        .bind(row.conversation_id, userId)
        .first<{ role: string }>();
      if (!member || !['owner', 'admin'].includes(member.role)) {
        throw new ApiError('forbidden', 'You cannot delete this message.', 403);
      }
    } else {
      await requireServerPermission(
        context.env.DB,
        userId,
        row.server_id,
        Permission.MANAGE_MESSAGES,
        row.channel_id,
      );
    }
  }
  await context.env.DB.batch([
    context.env.DB.prepare(
      `UPDATE messages SET content = '', deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    ).bind(row.id),
    context.env.DB.prepare('DELETE FROM message_attachments WHERE message_id = ?').bind(row.id),
    context.env.DB.prepare('DELETE FROM message_reactions WHERE message_id = ?').bind(row.id),
  ]);
  context.executionCtx.waitUntil(
    broadcastRoom(context.env, `${target.kind}:${target.id}`, {
      type: 'message.deleted',
      data: { id: row.id },
    }),
  );
  return context.body(null, 204);
});

messaging.post('/messages/:messageId/reactions', authenticate, requireCsrf, async (context) => {
  const input = await parseJson(context, reactionSchema);
  const userId = context.get('user').id;
  const row = await messageAccess(context.env.DB, context.req.param('messageId'));
  if (!row || row.deleted_at) throw new ApiError('not_found', 'Message not found.', 404);
  const target = await requireMessageAccess(context.env.DB, userId, row);
  await context.env.DB.prepare(
    'INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)',
  )
    .bind(row.id, userId, input.emoji)
    .run();
  const message = await fetchMessage(context.env.DB, row.id, userId);
  context.executionCtx.waitUntil(
    Promise.all([
      broadcastRoom(context.env, `${target.kind}:${target.id}`, {
        type: 'message.reactions',
        data: { id: row.id, reactions: message?.reactions ?? [] },
      }),
      createNotification(context.env.DB, row.author_id, userId, 'message_reaction', row.id, {
        emoji: input.emoji,
      }),
    ]).then(() => undefined),
  );
  return context.json({ data: { reacted: true } });
});

messaging.delete(
  '/messages/:messageId/reactions/:emoji',
  authenticate,
  requireCsrf,
  async (context) => {
    const userId = context.get('user').id;
    const row = await messageAccess(context.env.DB, context.req.param('messageId'));
    if (!row) throw new ApiError('not_found', 'Message not found.', 404);
    const target = await requireMessageAccess(context.env.DB, userId, row);
    await context.env.DB.prepare(
      'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
    )
      .bind(row.id, userId, decodeURIComponent(context.req.param('emoji')).slice(0, 32))
      .run();
    context.executionCtx.waitUntil(
      broadcastRoom(context.env, `${target.kind}:${target.id}`, {
        type: 'message.reactions',
        data: { id: row.id },
      }),
    );
    return context.body(null, 204);
  },
);

messaging.post('/messages/:messageId/forward', authenticate, requireCsrf, async (context) => {
  const input = await parseJson(context, forwardSchema);
  const userId = context.get('user').id;
  const source = await messageAccess(context.env.DB, context.req.param('messageId'));
  if (!source || source.deleted_at) throw new ApiError('not_found', 'Message not found.', 404);
  await requireMessageAccess(context.env.DB, userId, source);
  const target: MessageTarget = { kind: input.targetType, id: input.targetId };
  await authorizeMessageTarget(
    context.env.DB,
    userId,
    target,
    target.kind === 'channel' ? Permission.SEND_MESSAGES : Permission.VIEW_CHANNEL,
  );
  const messageId = newId('msg');
  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO messages
          (id, channel_id, conversation_id, author_id, content, client_nonce, forwarded_from_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      messageId,
      target.kind === 'channel' ? target.id : null,
      target.kind === 'conversation' ? target.id : null,
      userId,
      source.content,
      input.clientNonce,
      source.id,
    ),
    context.env.DB.prepare(
      `INSERT INTO message_attachments (message_id, upload_id, position)
         SELECT ?, upload_id, position FROM message_attachments WHERE message_id = ?`,
    ).bind(messageId, source.id),
  ]);
  context.executionCtx.waitUntil(emitMessageCreated(context, target, messageId));
  return context.json({ data: await fetchMessage(context.env.DB, messageId, userId) }, 201);
});

messaging.put(
  '/channels/:channelId/read/:messageId',
  authenticate,
  requireCsrf,
  async (context) => {
    const channelId = context.req.param('channelId');
    const userId = context.get('user').id;
    await authorizeMessageTarget(context.env.DB, userId, { kind: 'channel', id: channelId });
    const message = await context.env.DB.prepare(
      'SELECT 1 AS found FROM messages WHERE id = ? AND channel_id = ?',
    )
      .bind(context.req.param('messageId'), channelId)
      .first();
    if (!message) throw new ApiError('not_found', 'Message not found.', 404);
    await context.env.DB.prepare(
      `INSERT INTO channel_reads (channel_id, user_id, last_read_message_id) VALUES (?, ?, ?)
     ON CONFLICT(channel_id, user_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id,
       read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
      .bind(channelId, userId, context.req.param('messageId'))
      .run();
    return context.body(null, 204);
  },
);

messaging.put(
  '/conversations/:conversationId/read/:messageId',
  authenticate,
  requireCsrf,
  async (context) => {
    const conversationId = context.req.param('conversationId');
    const userId = context.get('user').id;
    await requireConversationMember(context.env.DB, userId, conversationId);
    const result = await context.env.DB.prepare(
      `UPDATE conversation_members SET last_read_message_id = ?
      WHERE conversation_id = ? AND user_id = ?
        AND EXISTS (SELECT 1 FROM messages WHERE id = ? AND conversation_id = ?)`,
    )
      .bind(
        context.req.param('messageId'),
        conversationId,
        userId,
        context.req.param('messageId'),
        conversationId,
      )
      .run();
    if (result.meta.changes === 0) throw new ApiError('not_found', 'Message not found.', 404);
    context.executionCtx.waitUntil(
      broadcastRoom(context.env, `conversation:${conversationId}`, {
        type: 'read',
        data: { userId, messageId: context.req.param('messageId') },
      }),
    );
    return context.body(null, 204);
  },
);

messaging.get('/messages/search', authenticate, async (context) => {
  const query = (context.req.query('q') ?? '').trim();
  const channelId = context.req.query('channelId');
  const conversationId = context.req.query('conversationId');
  if (query.length < 2 || query.length > 100 || Boolean(channelId) === Boolean(conversationId)) {
    throw new ApiError('invalid_search', 'Provide a query and exactly one message location.', 400);
  }
  const target: MessageTarget = channelId
    ? { kind: 'channel', id: channelId }
    : { kind: 'conversation', id: conversationId! };
  await authorizeMessageTarget(context.env.DB, context.get('user').id, target);
  await enforceRateLimit(context, 'message-search', context.get('user').id, 30, 60);
  const escaped = `%${query.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
  const column = target.kind === 'channel' ? 'm.channel_id' : 'm.conversation_id';
  const rows = await context.env.DB.prepare(
    `${messageSelect} WHERE ${column} = ? AND m.content LIKE ? ESCAPE '\\' AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC LIMIT 50`,
  )
    .bind(context.get('user').id, target.id, escaped)
    .all<MessageRow>();
  return context.json({ data: rows.results.map(mapMessage) });
});

messaging.post('/push-subscriptions', authenticate, requireCsrf, async (context) => {
  const input = await parseJson(context, pushSchema);
  await context.env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, platform)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
       auth = excluded.auth, platform = excluded.platform`,
  )
    .bind(
      newId('psh'),
      context.get('user').id,
      input.endpoint,
      input.keys.p256dh,
      input.keys.auth,
      input.platform,
    )
    .run();
  return context.json({ data: { subscribed: true } }, 201);
});

messaging.delete('/push-subscriptions', authenticate, requireCsrf, async (context) => {
  const input = await parseJson(
    context,
    v.object({ endpoint: v.pipe(v.string(), v.url(), v.maxLength(2_048)) }),
  );
  await context.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
    .bind(input.endpoint, context.get('user').id)
    .run();
  return context.body(null, 204);
});

messaging.post('/device-tokens', authenticate, requireCsrf, async (context) => {
  const input = await parseJson(context, deviceTokenSchema);
  await context.env.DB.prepare(
    `INSERT INTO device_tokens (id, user_id, token, platform) VALUES (?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  )
    .bind(newId('dev'), context.get('user').id, input.token, input.platform)
    .run();
  return context.json({ data: { registered: true } }, 201);
});

messaging.delete('/device-tokens', authenticate, requireCsrf, async (context) => {
  const input = await parseJson(context, v.object({ token: deviceTokenSchema.entries.token }));
  await context.env.DB.prepare('DELETE FROM device_tokens WHERE token = ? AND user_id = ?')
    .bind(input.token, context.get('user').id)
    .run();
  return context.body(null, 204);
});

export { fetchMessage, mapMessage, messageSelect };
export default messaging;
