import {
  commentSchema,
  decodeCursor,
  encodeCursor,
  newId,
  postSchema,
  reportSchema,
  searchSchema,
} from '@nexa/shared';
import { Hono } from 'hono';
import * as v from 'valibot';
import type { AppEnv } from '../env';
import { authenticate, publicUser, requireCsrf } from '../lib/auth';
import { ApiError } from '../lib/errors';
import { createNotification, notifyMentionedUsers } from '../lib/notifications';
import { enforceRateLimit } from '../lib/rate-limit';
import { boundedInteger, parseJson } from '../lib/validation';

const social = new Hono<AppEnv>();

interface PostRow {
  id: string;
  body: string;
  visibility: 'public' | 'followers' | 'friends';
  created_at: string;
  edited_at: string | null;
  author_id: string;
  username: string;
  display_name: string;
  avatar_key: string | null;
  status: string;
  like_count: number;
  comment_count: number;
  share_count: number;
  liked: number;
  media_json: string;
}

interface CommentRow {
  id: string;
  post_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  author_id: string;
  username: string;
  display_name: string;
  avatar_key: string | null;
  status: string;
  like_count: number;
  liked: number;
}

interface UserProfileRow {
  id: string;
  username: string;
  display_name: string;
  avatar_key: string | null;
  status: string;
  bio: string;
  locale: 'en' | 'ar';
  created_at: string;
  follower_count: number;
  following_count: number;
  is_following: number;
  is_blocked: number;
}

const postSelect = `
  SELECT p.id, p.body, p.visibility, p.created_at, p.edited_at,
         u.id AS author_id, u.username, u.display_name, u.avatar_key, u.status,
         (SELECT count(*) FROM post_likes pl WHERE pl.post_id = p.id) AS like_count,
         (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comment_count,
         (SELECT count(*) FROM post_shares ps WHERE ps.post_id = p.id) AS share_count,
         EXISTS(SELECT 1 FROM post_likes mine WHERE mine.post_id = p.id AND mine.user_id = ?) AS liked,
         COALESCE((
           SELECT json_group_array(json_object(
             'id', up.id, 'key', up.object_key, 'name', up.original_name,
             'mime', up.mime_type, 'size', up.byte_size,
             'width', up.width, 'height', up.height, 'durationMs', up.duration_ms
           )) FROM post_media pm JOIN uploads up ON up.id = pm.upload_id
           WHERE pm.post_id = p.id ORDER BY pm.position
         ), '[]') AS media_json
    FROM posts p JOIN users u ON u.id = p.author_id`;

function safeJsonArray(value: string): Array<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function mapPost(row: PostRow) {
  return {
    id: row.id,
    author: publicUser({
      id: row.author_id,
      username: row.username,
      display_name: row.display_name,
      avatar_key: row.avatar_key,
      status: row.status,
    }),
    body: row.body,
    visibility: row.visibility,
    media: safeJsonArray(row.media_json).map((media) => ({
      ...media,
      url: `/v1/media/${encodeURIComponent(String(media.key ?? ''))}`,
    })),
    likeCount: row.like_count,
    commentCount: row.comment_count,
    shareCount: row.share_count,
    liked: row.liked === 1,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

function mapComment(row: CommentRow) {
  return {
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_id,
    body: row.body,
    author: publicUser({
      id: row.author_id,
      username: row.username,
      display_name: row.display_name,
      avatar_key: row.avatar_key,
      status: row.status,
    }),
    likeCount: row.like_count,
    liked: row.liked === 1,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

social.get('/feed', authenticate, async (context) => {
  const userId = context.get('user').id;
  const limit = boundedInteger(context.req.query('limit'), 20, 1, 50);
  const cursor = context.req.query('cursor')
    ? decodeCursor<{ createdAt: string; id: string }>(context.req.query('cursor')!)
    : null;
  const cursorSql = cursor ? 'AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))' : '';
  const parameters: unknown[] = [userId, userId, userId, userId, userId, userId];
  if (cursor) parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
  parameters.push(limit + 1);
  const rows = await context.env.DB.prepare(
    `${postSelect}
      WHERE p.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
           WHERE (b.blocker_id = ? AND b.blocked_id = p.author_id)
              OR (b.blocker_id = p.author_id AND b.blocked_id = ?)
        )
        AND (
          p.author_id = ? OR p.visibility = 'public'
          OR (p.visibility = 'followers' AND EXISTS (
            SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = p.author_id AND f.status = 'accepted'
          ))
          OR (p.visibility = 'friends' AND EXISTS (
            SELECT 1 FROM follows f1 JOIN follows f2
              ON f2.follower_id = f1.following_id AND f2.following_id = f1.follower_id
             WHERE f1.follower_id = ? AND f1.following_id = p.author_id
               AND f1.status = 'accepted' AND f2.status = 'accepted'
          ))
        )
        ${cursorSql}
      ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
  )
    .bind(...parameters)
    .all<PostRow>();
  const hasMore = rows.results.length > limit;
  const items = rows.results.slice(0, limit);
  const last = items.at(-1);
  return context.json({
    data: {
      items: items.map(mapPost),
      nextCursor:
        hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
    },
  });
});

social.post('/posts', authenticate, requireCsrf, async (context) => {
  const userId = context.get('user').id;
  await enforceRateLimit(context, 'create-post', userId, 30, 60 * 60);
  const input = await parseJson(context, postSchema);
  let media: Array<{ id: string; object_key: string }> = [];
  if (input.mediaKeys.length > 0) {
    const placeholders = input.mediaKeys.map(() => '?').join(',');
    const results = await context.env.DB.prepare(
      `SELECT id, object_key FROM uploads WHERE owner_id = ? AND object_key IN (${placeholders})`,
    )
      .bind(userId, ...input.mediaKeys)
      .all<{ id: string; object_key: string }>();
    media = results.results;
    if (media.length !== input.mediaKeys.length) {
      throw new ApiError('invalid_upload', 'One or more uploads were not found.', 400);
    }
  }
  const postId = newId('pst');
  const statements = [
    context.env.DB.prepare(
      'INSERT INTO posts (id, author_id, body, visibility) VALUES (?, ?, ?, ?)',
    ).bind(postId, userId, input.body, input.visibility),
    ...input.mediaKeys.map((key, position) => {
      const upload = media.find((item) => item.object_key === key)!;
      return context.env.DB.prepare(
        'INSERT INTO post_media (post_id, upload_id, position) VALUES (?, ?, ?)',
      ).bind(postId, upload.id, position);
    }),
  ];
  await context.env.DB.batch(statements);
  context.executionCtx.waitUntil(
    notifyMentionedUsers(context.env.DB, input.body, userId, 'post_mention', postId),
  );
  const row = await context.env.DB.prepare(`${postSelect} WHERE p.id = ?`)
    .bind(userId, postId)
    .first<PostRow>();
  if (!row) throw new ApiError('create_failed', 'Post could not be created.', 500);
  return context.json({ data: mapPost(row) }, 201);
});

social.get('/posts/:postId', authenticate, async (context) => {
  const userId = context.get('user').id;
  const row = await context.env.DB.prepare(
    `${postSelect}
      WHERE p.id = ? AND p.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id = ? AND b.blocked_id = p.author_id) OR
          (b.blocker_id = p.author_id AND b.blocked_id = ?))`,
  )
    .bind(userId, context.req.param('postId'), userId, userId)
    .first<PostRow>();
  if (!row) throw new ApiError('not_found', 'Post not found.', 404);
  return context.json({ data: mapPost(row) });
});

social.patch('/posts/:postId', authenticate, requireCsrf, async (context) => {
  const input = await parseJson(context, postSchema);
  const result = await context.env.DB.prepare(
    `UPDATE posts SET body = ?, visibility = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND author_id = ? AND deleted_at IS NULL`,
  )
    .bind(input.body, input.visibility, context.req.param('postId'), context.get('user').id)
    .run();
  if (result.meta.changes === 0) throw new ApiError('not_found', 'Post not found.', 404);
  return context.json({ data: { updated: true } });
});

social.delete('/posts/:postId', authenticate, requireCsrf, async (context) => {
  const result = await context.env.DB.prepare(
    `UPDATE posts SET body = '', deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND author_id = ? AND deleted_at IS NULL`,
  )
    .bind(context.req.param('postId'), context.get('user').id)
    .run();
  if (result.meta.changes === 0) throw new ApiError('not_found', 'Post not found.', 404);
  return context.body(null, 204);
});

social.post('/posts/:postId/likes', authenticate, requireCsrf, async (context) => {
  const post = await context.env.DB.prepare(
    'SELECT author_id FROM posts WHERE id = ? AND deleted_at IS NULL',
  )
    .bind(context.req.param('postId'))
    .first<{ author_id: string }>();
  if (!post) throw new ApiError('not_found', 'Post not found.', 404);
  await context.env.DB.prepare('INSERT OR IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)')
    .bind(context.req.param('postId'), context.get('user').id)
    .run();
  context.executionCtx.waitUntil(
    createNotification(
      context.env.DB,
      post.author_id,
      context.get('user').id,
      'post_like',
      context.req.param('postId'),
    ),
  );
  return context.json({ data: { liked: true } });
});

social.delete('/posts/:postId/likes', authenticate, requireCsrf, async (context) => {
  await context.env.DB.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?')
    .bind(context.req.param('postId'), context.get('user').id)
    .run();
  return context.body(null, 204);
});

social.post('/posts/:postId/share', authenticate, requireCsrf, async (context) => {
  const post = await context.env.DB.prepare(
    'SELECT author_id FROM posts WHERE id = ? AND deleted_at IS NULL',
  )
    .bind(context.req.param('postId'))
    .first<{ author_id: string }>();
  if (!post) throw new ApiError('not_found', 'Post not found.', 404);
  await context.env.DB.prepare('INSERT OR IGNORE INTO post_shares (post_id, user_id) VALUES (?, ?)')
    .bind(context.req.param('postId'), context.get('user').id)
    .run();
  context.executionCtx.waitUntil(
    createNotification(
      context.env.DB,
      post.author_id,
      context.get('user').id,
      'post_share',
      context.req.param('postId'),
    ),
  );
  return context.json({ data: { shared: true } });
});

social.get('/posts/:postId/comments', authenticate, async (context) => {
  const limit = boundedInteger(context.req.query('limit'), 50, 1, 100);
  const rows = await context.env.DB.prepare(
    `SELECT c.id, c.post_id, c.parent_id, c.body, c.created_at, c.edited_at,
            u.id AS author_id, u.username, u.display_name, u.avatar_key, u.status,
            (SELECT count(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS like_count,
            EXISTS(SELECT 1 FROM comment_likes mine WHERE mine.comment_id = c.id AND mine.user_id = ?) AS liked
       FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.post_id = ? AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC LIMIT ?`,
  )
    .bind(context.get('user').id, context.req.param('postId'), limit)
    .all<CommentRow>();
  return context.json({ data: { items: rows.results.map(mapComment), nextCursor: null } });
});

social.post('/posts/:postId/comments', authenticate, requireCsrf, async (context) => {
  const userId = context.get('user').id;
  await enforceRateLimit(context, 'comment', userId, 100, 60 * 60);
  const input = await parseJson(context, commentSchema);
  const post = await context.env.DB.prepare(
    'SELECT author_id FROM posts WHERE id = ? AND deleted_at IS NULL',
  )
    .bind(context.req.param('postId'))
    .first<{ author_id: string }>();
  if (!post) throw new ApiError('not_found', 'Post not found.', 404);
  if (input.parentId) {
    const parent = await context.env.DB.prepare(
      'SELECT 1 AS found FROM comments WHERE id = ? AND post_id = ? AND deleted_at IS NULL',
    )
      .bind(input.parentId, context.req.param('postId'))
      .first();
    if (!parent) throw new ApiError('invalid_parent', 'Parent comment was not found.', 400);
  }
  const commentId = newId('cmt');
  await context.env.DB.prepare(
    'INSERT INTO comments (id, post_id, author_id, parent_id, body) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(commentId, context.req.param('postId'), userId, input.parentId ?? null, input.body)
    .run();
  context.executionCtx.waitUntil(
    Promise.all([
      createNotification(context.env.DB, post.author_id, userId, 'post_comment', commentId),
      notifyMentionedUsers(context.env.DB, input.body, userId, 'comment_mention', commentId),
    ]).then(() => undefined),
  );
  return context.json({ data: { id: commentId } }, 201);
});

social.post('/comments/:commentId/likes', authenticate, requireCsrf, async (context) => {
  const comment = await context.env.DB.prepare(
    'SELECT author_id FROM comments WHERE id = ? AND deleted_at IS NULL',
  )
    .bind(context.req.param('commentId'))
    .first<{ author_id: string }>();
  if (!comment) throw new ApiError('not_found', 'Comment not found.', 404);
  await context.env.DB.prepare(
    'INSERT OR IGNORE INTO comment_likes (comment_id, user_id) VALUES (?, ?)',
  )
    .bind(context.req.param('commentId'), context.get('user').id)
    .run();
  context.executionCtx.waitUntil(
    createNotification(
      context.env.DB,
      comment.author_id,
      context.get('user').id,
      'comment_like',
      context.req.param('commentId'),
    ),
  );
  return context.json({ data: { liked: true } });
});

social.delete('/comments/:commentId/likes', authenticate, requireCsrf, async (context) => {
  await context.env.DB.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?')
    .bind(context.req.param('commentId'), context.get('user').id)
    .run();
  return context.body(null, 204);
});

social.get('/users/:userId', authenticate, async (context) => {
  const viewer = context.get('user').id;
  const row = await context.env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.avatar_key,
            CASE WHEN json_extract(u.privacy_json, '$.showStatus') = 1 OR u.id = ? THEN u.status ELSE 'invisible' END AS status,
            u.bio, u.locale, u.created_at,
            (SELECT count(*) FROM follows f WHERE f.following_id = u.id AND f.status = 'accepted') AS follower_count,
            (SELECT count(*) FROM follows f WHERE f.follower_id = u.id AND f.status = 'accepted') AS following_count,
            EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = u.id AND f.status = 'accepted') AS is_following,
            EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id = ? AND b.blocked_id = u.id) AS is_blocked
       FROM users u
      WHERE u.id = ? AND u.deletion_requested_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = u.id AND b.blocked_id = ?)`,
  )
    .bind(viewer, viewer, viewer, context.req.param('userId'), viewer)
    .first<UserProfileRow>();
  if (!row) throw new ApiError('not_found', 'User not found.', 404);
  return context.json({
    data: {
      ...publicUser(row),
      bio: row.bio,
      locale: row.locale,
      createdAt: row.created_at,
      followerCount: row.follower_count,
      followingCount: row.following_count,
      isFollowing: row.is_following === 1,
      isBlocked: row.is_blocked === 1,
    },
  });
});

social.post('/users/:userId/follow', authenticate, requireCsrf, async (context) => {
  const target = context.req.param('userId');
  const userId = context.get('user').id;
  if (target === userId) throw new ApiError('invalid_target', 'You cannot follow yourself.', 400);
  const exists = await context.env.DB.prepare(
    `SELECT 1 AS found FROM users u WHERE u.id = ?
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))`,
  )
    .bind(target, userId, userId)
    .first();
  if (!exists) throw new ApiError('not_found', 'User not found.', 404);
  await context.env.DB.prepare(
    `INSERT INTO follows (follower_id, following_id, status) VALUES (?, ?, 'accepted')
     ON CONFLICT(follower_id, following_id) DO UPDATE SET status = 'accepted'`,
  )
    .bind(userId, target)
    .run();
  context.executionCtx.waitUntil(
    createNotification(context.env.DB, target, userId, 'new_follower', userId),
  );
  return context.json({ data: { following: true } });
});

social.delete('/users/:userId/follow', authenticate, requireCsrf, async (context) => {
  await context.env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?')
    .bind(context.get('user').id, context.req.param('userId'))
    .run();
  return context.body(null, 204);
});

social.post('/users/:userId/friend', authenticate, requireCsrf, async (context) => {
  const userId = context.get('user').id;
  const target = context.req.param('userId');
  if (target === userId) throw new ApiError('invalid_target', 'You cannot friend yourself.', 400);
  await context.env.DB.prepare(
    `INSERT INTO follows (follower_id, following_id, status) VALUES (?, ?, 'pending')
     ON CONFLICT(follower_id, following_id) DO NOTHING`,
  )
    .bind(userId, target)
    .run();
  context.executionCtx.waitUntil(
    createNotification(context.env.DB, target, userId, 'friend_request', userId),
  );
  return context.json({ data: { pending: true } }, 202);
});

social.post('/users/:userId/friend/accept', authenticate, requireCsrf, async (context) => {
  const userId = context.get('user').id;
  const requester = context.req.param('userId');
  const request = await context.env.DB.prepare(
    `SELECT 1 AS found FROM follows
      WHERE follower_id = ? AND following_id = ? AND status = 'pending'`,
  )
    .bind(requester, userId)
    .first();
  if (!request) throw new ApiError('not_found', 'Friend request not found.', 404);
  await context.env.DB.batch([
    context.env.DB.prepare(
      "UPDATE follows SET status = 'accepted' WHERE follower_id = ? AND following_id = ?",
    ).bind(requester, userId),
    context.env.DB.prepare(
      `INSERT INTO follows (follower_id, following_id, status) VALUES (?, ?, 'accepted')
         ON CONFLICT(follower_id, following_id) DO UPDATE SET status = 'accepted'`,
    ).bind(userId, requester),
  ]);
  context.executionCtx.waitUntil(
    createNotification(context.env.DB, requester, userId, 'friend_accepted', userId),
  );
  return context.json({ data: { friends: true } });
});

social.post('/users/:userId/block', authenticate, requireCsrf, async (context) => {
  const userId = context.get('user').id;
  const target = context.req.param('userId');
  if (target === userId) throw new ApiError('invalid_target', 'You cannot block yourself.', 400);
  await context.env.DB.batch([
    context.env.DB.prepare(
      'INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)',
    ).bind(userId, target),
    context.env.DB.prepare(
      'DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)',
    ).bind(userId, target, target, userId),
  ]);
  return context.json({ data: { blocked: true } });
});

social.delete('/users/:userId/block', authenticate, requireCsrf, async (context) => {
  await context.env.DB.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
    .bind(context.get('user').id, context.req.param('userId'))
    .run();
  return context.body(null, 204);
});

social.post('/reports', authenticate, requireCsrf, async (context) => {
  const userId = context.get('user').id;
  await enforceRateLimit(context, 'report', userId, 10, 24 * 60 * 60);
  const input = await parseJson(context, reportSchema);
  const reportId = newId('rpt');
  await context.env.DB.prepare(
    `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(reportId, userId, input.targetType, input.targetId, input.reason, input.details)
    .run();
  return context.json({ data: { id: reportId } }, 201);
});

social.get('/search', authenticate, async (context) => {
  const parsed = v.safeParse(searchSchema, {
    query: context.req.query('q') ?? '',
    type: context.req.query('type') ?? 'all',
  });
  if (!parsed.success) throw new ApiError('validation_failed', 'Search query is invalid.', 400);
  await enforceRateLimit(context, 'search', context.get('user').id, 60, 60);
  const escaped = parsed.output.query.replace(/[\\%_]/g, (value) => `\\${value}`);
  const pattern = `%${escaped}%`;
  const users =
    parsed.output.type === 'all' || parsed.output.type === 'users'
      ? await context.env.DB.prepare(
          `SELECT id, username, display_name, avatar_key, status FROM users
            WHERE (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
              AND json_extract(privacy_json, '$.discoverable') = 1
              AND deletion_requested_at IS NULL LIMIT 20`,
        )
          .bind(pattern, pattern)
          .all<{
            id: string;
            username: string;
            display_name: string;
            avatar_key: string | null;
            status: string;
          }>()
      : { results: [] };
  const posts =
    parsed.output.type === 'all' || parsed.output.type === 'posts'
      ? await context.env.DB.prepare(
          `SELECT id, body, author_id, created_at FROM posts
            WHERE body LIKE ? ESCAPE '\\' AND visibility = 'public' AND deleted_at IS NULL
            ORDER BY created_at DESC LIMIT 20`,
        )
          .bind(pattern)
          .all()
      : { results: [] };
  const servers =
    parsed.output.type === 'all' || parsed.output.type === 'servers'
      ? await context.env.DB.prepare(
          `SELECT id, name, description, icon_key FROM servers
            WHERE (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') AND visibility = 'public'
            LIMIT 20`,
        )
          .bind(pattern, pattern)
          .all()
      : { results: [] };
  return context.json({
    data: {
      users: users.results.map(publicUser),
      posts: posts.results,
      servers: servers.results,
    },
  });
});

social.get('/notifications', authenticate, async (context) => {
  const limit = boundedInteger(context.req.query('limit'), 30, 1, 100);
  const rows = await context.env.DB.prepare(
    `SELECT n.id, n.type, n.entity_id, n.payload_json, n.read_at, n.created_at,
            u.id AS actor_id, u.username, u.display_name, u.avatar_key, u.status
       FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
      WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT ?`,
  )
    .bind(context.get('user').id, limit)
    .all<{
      id: string;
      type: string;
      entity_id: string | null;
      payload_json: string;
      read_at: string | null;
      created_at: string;
      actor_id: string | null;
      username: string | null;
      display_name: string | null;
      avatar_key: string | null;
      status: string | null;
    }>();
  return context.json({
    data: rows.results.map((row) => ({
      id: row.id,
      type: row.type,
      entityId: row.entity_id,
      payload: JSON.parse(row.payload_json) as unknown,
      read: row.read_at !== null,
      createdAt: row.created_at,
      actor:
        row.actor_id && row.username && row.display_name
          ? publicUser({
              id: row.actor_id,
              username: row.username,
              display_name: row.display_name,
              avatar_key: row.avatar_key,
              status: row.status ?? 'invisible',
            })
          : null,
    })),
  });
});

social.post('/notifications/read', authenticate, requireCsrf, async (context) => {
  const input = await parseJson(
    context,
    v.object({ ids: v.optional(v.pipe(v.array(v.string()), v.maxLength(100)), []) }),
  );
  if (input.ids.length === 0) {
    await context.env.DB.prepare(
      "UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE user_id = ? AND read_at IS NULL",
    )
      .bind(context.get('user').id)
      .run();
  } else {
    const placeholders = input.ids.map(() => '?').join(',');
    await context.env.DB.prepare(
      `UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE user_id = ? AND id IN (${placeholders})`,
    )
      .bind(context.get('user').id, ...input.ids)
      .run();
  }
  return context.json({ data: { read: true } });
});

const privacySchema = v.object({
  discoverable: v.boolean(),
  dmFrom: v.picklist(['everyone', 'friends', 'none']),
  showStatus: v.boolean(),
});

social.get('/privacy', authenticate, async (context) => {
  const row = await context.env.DB.prepare('SELECT privacy_json FROM users WHERE id = ?')
    .bind(context.get('user').id)
    .first<{ privacy_json: string }>();
  return context.json({ data: row ? JSON.parse(row.privacy_json) : null });
});

social.put('/privacy', authenticate, requireCsrf, async (context) => {
  const input = await parseJson(context, privacySchema);
  await context.env.DB.prepare('UPDATE users SET privacy_json = ? WHERE id = ?')
    .bind(JSON.stringify(input), context.get('user').id)
    .run();
  return context.json({ data: input });
});

export default social;
