import {
  ALL_PERMISSIONS,
  DEFAULT_MEMBER_PERMISSIONS,
  Permission,
  channelSchema,
  inviteSchema,
  newId,
  roleSchema,
  serverSchema,
} from '@nexa/shared';
import { Hono } from 'hono';
import * as v from 'valibot';
import type { AppEnv } from '../env';
import { authenticate, publicUser, requireCsrf } from '../lib/auth';
import { writeAuditLog } from '../lib/audit';
import { ApiError } from '../lib/errors';
import { requireServerPermission, resolveServerPermissions } from '../lib/permissions';
import { randomToken } from '../lib/crypto';
import { enforceRateLimit } from '../lib/rate-limit';
import { boundedInteger, parseJson } from '../lib/validation';

const communities = new Hono<AppEnv>();

interface ServerRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  icon_key: string | null;
  visibility: 'private' | 'public';
  automod_json: string;
  created_at: string;
  member_count: number;
}

interface ChannelRow {
  id: string;
  server_id: string;
  category_id: string | null;
  name: string;
  topic: string;
  type: 'text' | 'voice' | 'announcement';
  position: number;
  slow_mode_seconds: number;
}

interface RoleRow {
  id: string;
  server_id: string;
  name: string;
  color: string;
  permissions: number;
  position: number;
  is_everyone: number;
}

const categorySchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
});
const channelUpdateSchema = v.object({
  name: v.optional(v.pipe(v.string(), v.trim(), v.toLowerCase(), v.minLength(1), v.maxLength(80))),
  topic: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1_024))),
  categoryId: v.optional(v.nullable(v.string())),
  slowModeSeconds: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(21_600))),
  position: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10_000))),
});
const roleUpdateSchema = v.object({
  name: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80))),
  color: v.optional(v.pipe(v.string(), v.regex(/^#[0-9a-f]{6}$/iu))),
  permissions: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(ALL_PERMISSIONS)),
  ),
  position: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10_000))),
});
const overwriteSchema = v.object({
  targetId: v.string(),
  targetType: v.picklist(['role', 'member']),
  allow: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(ALL_PERMISSIONS)),
  deny: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(ALL_PERMISSIONS)),
});
const moderationSchema = v.object({
  reason: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500)), ''),
});
const muteSchema = v.object({
  seconds: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(604_800)),
  reason: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500)), ''),
});
const automodSchema = v.object({
  maxMessages: v.pipe(v.number(), v.integer(), v.minValue(3), v.maxValue(30)),
  windowSeconds: v.pipe(v.number(), v.integer(), v.minValue(3), v.maxValue(60)),
  blockLinks: v.boolean(),
  bannedWords: v.pipe(
    v.array(v.pipe(v.string(), v.trim(), v.toLowerCase(), v.minLength(2), v.maxLength(40))),
    v.maxLength(50),
  ),
});

function mapServer(row: ServerRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    iconUrl: row.icon_key ? `/v1/media/${encodeURIComponent(row.icon_key)}` : null,
    visibility: row.visibility,
    memberCount: row.member_count,
    createdAt: row.created_at,
  };
}

function mapChannel(row: ChannelRow) {
  return {
    id: row.id,
    serverId: row.server_id,
    categoryId: row.category_id,
    name: row.name,
    topic: row.topic,
    type: row.type,
    position: row.position,
    slowModeSeconds: row.slow_mode_seconds,
  };
}

async function serverRow(database: D1Database, serverId: string): Promise<ServerRow | null> {
  return database
    .prepare(
      `SELECT s.id, s.owner_id, s.name, s.description, s.icon_key, s.visibility,
              s.automod_json, s.created_at,
              (SELECT count(*) FROM server_members sm WHERE sm.server_id = s.id) AS member_count
         FROM servers s WHERE s.id = ?`,
    )
    .bind(serverId)
    .first<ServerRow>();
}

communities.get('/servers', authenticate, async (context) => {
  const rows = await context.env.DB.prepare(
    `SELECT s.id, s.owner_id, s.name, s.description, s.icon_key, s.visibility,
            s.automod_json, s.created_at,
            (SELECT count(*) FROM server_members members WHERE members.server_id = s.id) AS member_count
       FROM servers s JOIN server_members sm ON sm.server_id = s.id
      WHERE sm.user_id = ? ORDER BY sm.joined_at DESC LIMIT 100`,
  )
    .bind(context.get('user').id)
    .all<ServerRow>();
  return context.json({ data: rows.results.map(mapServer) });
});

communities.get('/servers/discover', authenticate, async (context) => {
  const limit = boundedInteger(context.req.query('limit'), 30, 1, 50);
  const rows = await context.env.DB.prepare(
    `SELECT s.id, s.owner_id, s.name, s.description, s.icon_key, s.visibility,
            s.automod_json, s.created_at,
            (SELECT count(*) FROM server_members sm WHERE sm.server_id = s.id) AS member_count
       FROM servers s WHERE s.visibility = 'public'
      ORDER BY member_count DESC, s.created_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all<ServerRow>();
  return context.json({ data: rows.results.map(mapServer) });
});

communities.post('/servers', authenticate, requireCsrf, async (context) => {
  const userId = context.get('user').id;
  await enforceRateLimit(context, 'create-server', userId, 10, 24 * 60 * 60);
  const input = await parseJson(context, serverSchema);
  const serverId = newId('srv');
  const roleId = newId('rol');
  const channelId = newId('chn');
  await context.env.DB.batch([
    context.env.DB.prepare(
      'INSERT INTO servers (id, owner_id, name, description, visibility) VALUES (?, ?, ?, ?, ?)',
    ).bind(serverId, userId, input.name, input.description, input.visibility),
    context.env.DB.prepare('INSERT INTO server_members (server_id, user_id) VALUES (?, ?)').bind(
      serverId,
      userId,
    ),
    context.env.DB.prepare(
      `INSERT INTO roles (id, server_id, name, permissions, position, is_everyone)
         VALUES (?, ?, '@everyone', ?, 0, 1)`,
    ).bind(roleId, serverId, DEFAULT_MEMBER_PERMISSIONS),
    context.env.DB.prepare(
      `INSERT INTO channels (id, server_id, name, topic, type, position)
         VALUES (?, ?, 'general', 'Welcome to your community', 'text', 0)`,
    ).bind(channelId, serverId),
  ]);
  await writeAuditLog(context.env.DB, serverId, userId, 'server.create', 'server', serverId, {
    name: input.name,
  });
  const row = await serverRow(context.env.DB, serverId);
  return context.json({ data: { ...mapServer(row!), defaultChannelId: channelId } }, 201);
});

communities.get('/servers/:serverId', authenticate, async (context) => {
  const serverId = context.req.param('serverId');
  const userId = context.get('user').id;
  const basePermission = await resolveServerPermissions(context.env.DB, userId, serverId);
  const server = await serverRow(context.env.DB, serverId);
  if (!server) throw new ApiError('not_found', 'Community not found.', 404);
  const [categoryResults, channelResults, roleResults] = await context.env.DB.batch([
    context.env.DB.prepare(
      'SELECT id, name, position FROM categories WHERE server_id = ? ORDER BY position',
    ).bind(serverId),
    context.env.DB.prepare(
      `SELECT id, server_id, category_id, name, topic, type, position, slow_mode_seconds
           FROM channels WHERE server_id = ? ORDER BY position`,
    ).bind(serverId),
    context.env.DB.prepare(
      'SELECT id, server_id, name, color, permissions, position, is_everyone FROM roles WHERE server_id = ? ORDER BY position DESC',
    ).bind(serverId),
  ]);
  const visibleChannels: ChannelRow[] = [];
  for (const channel of channelResults!.results as unknown as ChannelRow[]) {
    const permission = await resolveServerPermissions(context.env.DB, userId, serverId, channel.id);
    if ((permission.mask & Permission.VIEW_CHANNEL) !== 0) visibleChannels.push(channel);
  }
  return context.json({
    data: {
      ...mapServer(server),
      permissions: basePermission.mask,
      automod: JSON.parse(server.automod_json) as unknown,
      categories: categoryResults!.results,
      channels: visibleChannels.map(mapChannel),
      roles: (roleResults!.results as unknown as RoleRow[]).map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        permissions: role.permissions,
        position: role.position,
        everyone: role.is_everyone === 1,
      })),
    },
  });
});

communities.patch('/servers/:serverId', authenticate, requireCsrf, async (context) => {
  const serverId = context.req.param('serverId');
  const userId = context.get('user').id;
  await requireServerPermission(context.env.DB, userId, serverId, Permission.MANAGE_SERVER);
  const input = await parseJson(context, serverSchema);
  await context.env.DB.prepare(
    `UPDATE servers SET name = ?, description = ?, visibility = ?,
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
  )
    .bind(input.name, input.description, input.visibility, serverId)
    .run();
  await writeAuditLog(context.env.DB, serverId, userId, 'server.update', 'server', serverId);
  return context.json({ data: { updated: true } });
});

communities.delete('/servers/:serverId', authenticate, requireCsrf, async (context) => {
  const serverId = context.req.param('serverId');
  const userId = context.get('user').id;
  const result = await context.env.DB.prepare('DELETE FROM servers WHERE id = ? AND owner_id = ?')
    .bind(serverId, userId)
    .run();
  if (result.meta.changes === 0) {
    throw new ApiError('owner_required', 'Only the community owner can delete it.', 403);
  }
  return context.body(null, 204);
});

communities.post('/servers/:serverId/join', authenticate, requireCsrf, async (context) => {
  const serverId = context.req.param('serverId');
  const userId = context.get('user').id;
  const server = await context.env.DB.prepare(
    `SELECT id FROM servers WHERE id = ? AND visibility = 'public'
      AND NOT EXISTS (SELECT 1 FROM bans WHERE server_id = ? AND user_id = ?)`,
  )
    .bind(serverId, serverId, userId)
    .first();
  if (!server) throw new ApiError('not_found', 'Public community not found.', 404);
  await context.env.DB.prepare(
    'INSERT OR IGNORE INTO server_members (server_id, user_id) VALUES (?, ?)',
  )
    .bind(serverId, userId)
    .run();
  return context.json({ data: { joined: true } });
});

communities.delete('/servers/:serverId/members/me', authenticate, requireCsrf, async (context) => {
  const serverId = context.req.param('serverId');
  const userId = context.get('user').id;
  const server = await context.env.DB.prepare('SELECT owner_id FROM servers WHERE id = ?')
    .bind(serverId)
    .first<{ owner_id: string }>();
  if (!server) throw new ApiError('not_found', 'Community not found.', 404);
  if (server.owner_id === userId) {
    throw new ApiError(
      'owner_cannot_leave',
      'Transfer ownership or delete the community first.',
      409,
    );
  }
  await context.env.DB.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?')
    .bind(serverId, userId)
    .run();
  return context.body(null, 204);
});

communities.get('/servers/:serverId/members', authenticate, async (context) => {
  const serverId = context.req.param('serverId');
  await requireServerPermission(
    context.env.DB,
    context.get('user').id,
    serverId,
    Permission.VIEW_CHANNEL,
  );
  const rows = await context.env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.avatar_key, u.status, sm.nickname,
            sm.muted_until, sm.joined_at,
            COALESCE((SELECT json_group_array(role_id) FROM member_roles mr
                       WHERE mr.server_id = sm.server_id AND mr.user_id = sm.user_id), '[]') AS role_ids
       FROM server_members sm JOIN users u ON u.id = sm.user_id
      WHERE sm.server_id = ? ORDER BY sm.joined_at LIMIT 1000`,
  )
    .bind(serverId)
    .all<{
      id: string;
      username: string;
      display_name: string;
      avatar_key: string | null;
      status: string;
      nickname: string | null;
      muted_until: number | null;
      joined_at: string;
      role_ids: string;
    }>();
  return context.json({
    data: rows.results.map((row) => ({
      user: publicUser(row),
      nickname: row.nickname,
      mutedUntil: row.muted_until ? new Date(row.muted_until * 1000).toISOString() : null,
      joinedAt: row.joined_at,
      roleIds: JSON.parse(row.role_ids) as string[],
    })),
  });
});

communities.post('/servers/:serverId/categories', authenticate, requireCsrf, async (context) => {
  const serverId = context.req.param('serverId');
  const userId = context.get('user').id;
  await requireServerPermission(context.env.DB, userId, serverId, Permission.MANAGE_CHANNELS);
  const input = await parseJson(context, categorySchema);
  const categoryId = newId('cat');
  const position = await context.env.DB.prepare(
    'SELECT COALESCE(max(position), -1) + 1 AS position FROM categories WHERE server_id = ?',
  )
    .bind(serverId)
    .first<{ position: number }>();
  await context.env.DB.prepare(
    'INSERT INTO categories (id, server_id, name, position) VALUES (?, ?, ?, ?)',
  )
    .bind(categoryId, serverId, input.name, position?.position ?? 0)
    .run();
  await writeAuditLog(context.env.DB, serverId, userId, 'category.create', 'category', categoryId);
  return context.json({ data: { id: categoryId, name: input.name } }, 201);
});

communities.post('/servers/:serverId/channels', authenticate, requireCsrf, async (context) => {
  const serverId = context.req.param('serverId');
  const userId = context.get('user').id;
  await requireServerPermission(context.env.DB, userId, serverId, Permission.MANAGE_CHANNELS);
  const input = await parseJson(context, channelSchema);
  if (input.categoryId) {
    const category = await context.env.DB.prepare(
      'SELECT 1 AS found FROM categories WHERE id = ? AND server_id = ?',
    )
      .bind(input.categoryId, serverId)
      .first();
    if (!category) throw new ApiError('invalid_category', 'Category not found.', 400);
  }
  const position = await context.env.DB.prepare(
    'SELECT COALESCE(max(position), -1) + 1 AS position FROM channels WHERE server_id = ?',
  )
    .bind(serverId)
    .first<{ position: number }>();
  const channelId = newId('chn');
  await context.env.DB.prepare(
    `INSERT INTO channels (id, server_id, category_id, name, topic, type, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      channelId,
      serverId,
      input.categoryId ?? null,
      input.name,
      input.topic,
      input.type,
      position?.position ?? 0,
    )
    .run();
  await writeAuditLog(context.env.DB, serverId, userId, 'channel.create', 'channel', channelId, {
    type: input.type,
  });
  return context.json(
    {
      data: mapChannel({
        id: channelId,
        server_id: serverId,
        category_id: input.categoryId ?? null,
        name: input.name,
        topic: input.topic,
        type: input.type,
        position: position?.position ?? 0,
        slow_mode_seconds: 0,
      }),
    },
    201,
  );
});

communities.patch('/channels/:channelId', authenticate, requireCsrf, async (context) => {
  const channelId = context.req.param('channelId');
  const channel = await context.env.DB.prepare(
    'SELECT id, server_id, category_id, name, topic, type, position, slow_mode_seconds FROM channels WHERE id = ?',
  )
    .bind(channelId)
    .first<ChannelRow>();
  if (!channel) throw new ApiError('not_found', 'Channel not found.', 404);
  const userId = context.get('user').id;
  await requireServerPermission(
    context.env.DB,
    userId,
    channel.server_id,
    Permission.MANAGE_CHANNELS,
  );
  const input = await parseJson(context, channelUpdateSchema);
  if (input.categoryId) {
    const valid = await context.env.DB.prepare(
      'SELECT 1 AS found FROM categories WHERE id = ? AND server_id = ?',
    )
      .bind(input.categoryId, channel.server_id)
      .first();
    if (!valid) throw new ApiError('invalid_category', 'Category not found.', 400);
  }
  await context.env.DB.prepare(
    `UPDATE channels SET name = ?, topic = ?, category_id = ?, slow_mode_seconds = ?, position = ?
      WHERE id = ?`,
  )
    .bind(
      input.name ?? channel.name,
      input.topic ?? channel.topic,
      input.categoryId === undefined ? channel.category_id : input.categoryId,
      input.slowModeSeconds ?? channel.slow_mode_seconds,
      input.position ?? channel.position,
      channelId,
    )
    .run();
  await writeAuditLog(
    context.env.DB,
    channel.server_id,
    userId,
    'channel.update',
    'channel',
    channelId,
  );
  return context.json({ data: { updated: true } });
});

communities.delete('/channels/:channelId', authenticate, requireCsrf, async (context) => {
  const channel = await context.env.DB.prepare('SELECT server_id FROM channels WHERE id = ?')
    .bind(context.req.param('channelId'))
    .first<{ server_id: string }>();
  if (!channel) throw new ApiError('not_found', 'Channel not found.', 404);
  const userId = context.get('user').id;
  await requireServerPermission(
    context.env.DB,
    userId,
    channel.server_id,
    Permission.MANAGE_CHANNELS,
  );
  await context.env.DB.prepare('DELETE FROM channels WHERE id = ?')
    .bind(context.req.param('channelId'))
    .run();
  await writeAuditLog(
    context.env.DB,
    channel.server_id,
    userId,
    'channel.delete',
    'channel',
    context.req.param('channelId'),
  );
  return context.body(null, 204);
});

communities.put('/channels/:channelId/overwrites', authenticate, requireCsrf, async (context) => {
  const channelId = context.req.param('channelId');
  const channel = await context.env.DB.prepare('SELECT server_id FROM channels WHERE id = ?')
    .bind(channelId)
    .first<{ server_id: string }>();
  if (!channel) throw new ApiError('not_found', 'Channel not found.', 404);
  const userId = context.get('user').id;
  const actor = await requireServerPermission(
    context.env.DB,
    userId,
    channel.server_id,
    Permission.MANAGE_CHANNELS,
  );
  const input = await parseJson(context, overwriteSchema);
  if ((input.allow & ~actor.mask) !== 0) {
    throw new ApiError(
      'permission_escalation',
      'You cannot grant permissions you do not have.',
      403,
    );
  }
  const target =
    input.targetType === 'role'
      ? await context.env.DB.prepare('SELECT 1 AS found FROM roles WHERE id = ? AND server_id = ?')
          .bind(input.targetId, channel.server_id)
          .first()
      : await context.env.DB.prepare(
          'SELECT 1 AS found FROM server_members WHERE user_id = ? AND server_id = ?',
        )
          .bind(input.targetId, channel.server_id)
          .first();
  if (!target) throw new ApiError('invalid_target', 'Overwrite target was not found.', 400);
  await context.env.DB.prepare(
    `INSERT INTO channel_overwrites (channel_id, target_id, target_type, allow_mask, deny_mask)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(channel_id, target_id, target_type)
     DO UPDATE SET allow_mask = excluded.allow_mask, deny_mask = excluded.deny_mask`,
  )
    .bind(channelId, input.targetId, input.targetType, input.allow, input.deny)
    .run();
  await writeAuditLog(
    context.env.DB,
    channel.server_id,
    userId,
    'overwrite.update',
    'channel',
    channelId,
  );
  return context.json({ data: { updated: true } });
});

communities.post('/servers/:serverId/roles', authenticate, requireCsrf, async (context) => {
  const serverId = context.req.param('serverId');
  const userId = context.get('user').id;
  const actor = await requireServerPermission(
    context.env.DB,
    userId,
    serverId,
    Permission.MANAGE_ROLES,
  );
  const input = await parseJson(context, roleSchema);
  if ((input.permissions & ~actor.mask) !== 0) {
    throw new ApiError(
      'permission_escalation',
      'You cannot grant permissions you do not have.',
      403,
    );
  }
  const roleId = newId('rol');
  const position = await context.env.DB.prepare(
    'SELECT COALESCE(max(position), 0) + 1 AS position FROM roles WHERE server_id = ?',
  )
    .bind(serverId)
    .first<{ position: number }>();
  await context.env.DB.prepare(
    'INSERT INTO roles (id, server_id, name, color, permissions, position) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(roleId, serverId, input.name, input.color, input.permissions, position?.position ?? 1)
    .run();
  await writeAuditLog(context.env.DB, serverId, userId, 'role.create', 'role', roleId);
  return context.json({ data: { id: roleId } }, 201);
});

communities.patch('/roles/:roleId', authenticate, requireCsrf, async (context) => {
  const role = await context.env.DB.prepare(
    'SELECT id, server_id, name, color, permissions, position, is_everyone FROM roles WHERE id = ?',
  )
    .bind(context.req.param('roleId'))
    .first<RoleRow>();
  if (!role) throw new ApiError('not_found', 'Role not found.', 404);
  const userId = context.get('user').id;
  const actor = await requireServerPermission(
    context.env.DB,
    userId,
    role.server_id,
    Permission.MANAGE_ROLES,
  );
  const input = await parseJson(context, roleUpdateSchema);
  const permissions = input.permissions ?? role.permissions;
  if ((permissions & ~actor.mask) !== 0) {
    throw new ApiError(
      'permission_escalation',
      'You cannot grant permissions you do not have.',
      403,
    );
  }
  await context.env.DB.prepare(
    'UPDATE roles SET name = ?, color = ?, permissions = ?, position = ? WHERE id = ?',
  )
    .bind(
      role.is_everyone ? '@everyone' : (input.name ?? role.name),
      input.color ?? role.color,
      permissions,
      role.is_everyone ? 0 : (input.position ?? role.position),
      role.id,
    )
    .run();
  await writeAuditLog(context.env.DB, role.server_id, userId, 'role.update', 'role', role.id);
  return context.json({ data: { updated: true } });
});

communities.delete('/roles/:roleId', authenticate, requireCsrf, async (context) => {
  const role = await context.env.DB.prepare('SELECT server_id, is_everyone FROM roles WHERE id = ?')
    .bind(context.req.param('roleId'))
    .first<{ server_id: string; is_everyone: number }>();
  if (!role) throw new ApiError('not_found', 'Role not found.', 404);
  if (role.is_everyone === 1)
    throw new ApiError('protected_role', '@everyone cannot be deleted.', 409);
  const userId = context.get('user').id;
  await requireServerPermission(context.env.DB, userId, role.server_id, Permission.MANAGE_ROLES);
  await context.env.DB.prepare('DELETE FROM roles WHERE id = ?')
    .bind(context.req.param('roleId'))
    .run();
  await writeAuditLog(
    context.env.DB,
    role.server_id,
    userId,
    'role.delete',
    'role',
    context.req.param('roleId'),
  );
  return context.body(null, 204);
});

communities.put(
  '/servers/:serverId/members/:userId/roles/:roleId',
  authenticate,
  requireCsrf,
  async (context) => {
    const serverId = context.req.param('serverId');
    const actorId = context.get('user').id;
    const actor = await requireServerPermission(
      context.env.DB,
      actorId,
      serverId,
      Permission.MANAGE_ROLES,
    );
    const role = await context.env.DB.prepare(
      'SELECT permissions, is_everyone FROM roles WHERE id = ? AND server_id = ?',
    )
      .bind(context.req.param('roleId'), serverId)
      .first<{ permissions: number; is_everyone: number }>();
    if (!role || role.is_everyone === 1) throw new ApiError('invalid_role', 'Role not found.', 404);
    if ((role.permissions & ~actor.mask) !== 0) {
      throw new ApiError('permission_escalation', 'You cannot assign this role.', 403);
    }
    await context.env.DB.prepare(
      `INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id)
     SELECT ?, ?, ? WHERE EXISTS (
       SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?
     )`,
    )
      .bind(
        serverId,
        context.req.param('userId'),
        context.req.param('roleId'),
        serverId,
        context.req.param('userId'),
      )
      .run();
    await writeAuditLog(
      context.env.DB,
      serverId,
      actorId,
      'member.role.add',
      'member',
      context.req.param('userId'),
      {
        roleId: context.req.param('roleId'),
      },
    );
    return context.json({ data: { assigned: true } });
  },
);

communities.delete(
  '/servers/:serverId/members/:userId/roles/:roleId',
  authenticate,
  requireCsrf,
  async (context) => {
    const serverId = context.req.param('serverId');
    const actorId = context.get('user').id;
    await requireServerPermission(context.env.DB, actorId, serverId, Permission.MANAGE_ROLES);
    await context.env.DB.prepare(
      'DELETE FROM member_roles WHERE server_id = ? AND user_id = ? AND role_id = ?',
    )
      .bind(serverId, context.req.param('userId'), context.req.param('roleId'))
      .run();
    await writeAuditLog(
      context.env.DB,
      serverId,
      actorId,
      'member.role.remove',
      'member',
      context.req.param('userId'),
      {
        roleId: context.req.param('roleId'),
      },
    );
    return context.body(null, 204);
  },
);

communities.post('/servers/:serverId/invites', authenticate, requireCsrf, async (context) => {
  const serverId = context.req.param('serverId');
  const userId = context.get('user').id;
  await enforceRateLimit(context, 'invite', userId, 20, 60 * 60);
  await requireServerPermission(context.env.DB, userId, serverId, Permission.CREATE_INVITES);
  const input = await parseJson(context, inviteSchema);
  if (input.channelId) {
    const channel = await context.env.DB.prepare(
      'SELECT 1 AS found FROM channels WHERE id = ? AND server_id = ?',
    )
      .bind(input.channelId, serverId)
      .first();
    if (!channel) throw new ApiError('invalid_channel', 'Channel not found.', 400);
  }
  const code = randomToken(9);
  const now = Math.floor(Date.now() / 1000);
  await context.env.DB.prepare(
    `INSERT INTO invites (code, server_id, channel_id, creator_id, expires_at, max_uses, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      code,
      serverId,
      input.channelId ?? null,
      userId,
      input.expiresInSeconds === null ? null : now + input.expiresInSeconds,
      input.maxUses,
      now,
    )
    .run();
  return context.json({ data: { code, url: `${context.env.WEB_URL}/invite/${code}` } }, 201);
});

communities.post('/invites/:code/join', authenticate, requireCsrf, async (context) => {
  const userId = context.get('user').id;
  const now = Math.floor(Date.now() / 1000);
  const invite = await context.env.DB.prepare(
    `UPDATE invites SET use_count = use_count + 1
      WHERE code = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
        AND (max_uses = 0 OR use_count < max_uses)
      RETURNING server_id, channel_id`,
  )
    .bind(context.req.param('code'), now)
    .first<{ server_id: string; channel_id: string | null }>();
  if (!invite) throw new ApiError('invalid_invite', 'Invite is invalid or expired.', 404);
  const banned = await context.env.DB.prepare(
    'SELECT 1 AS banned FROM bans WHERE server_id = ? AND user_id = ?',
  )
    .bind(invite.server_id, userId)
    .first();
  if (banned) throw new ApiError('banned', 'You cannot join this community.', 403);
  await context.env.DB.prepare(
    'INSERT OR IGNORE INTO server_members (server_id, user_id) VALUES (?, ?)',
  )
    .bind(invite.server_id, userId)
    .run();
  return context.json({
    data: { serverId: invite.server_id, channelId: invite.channel_id, joined: true },
  });
});

communities.delete(
  '/servers/:serverId/invites/:code',
  authenticate,
  requireCsrf,
  async (context) => {
    const serverId = context.req.param('serverId');
    await requireServerPermission(
      context.env.DB,
      context.get('user').id,
      serverId,
      Permission.MANAGE_SERVER,
    );
    await context.env.DB.prepare(
      'UPDATE invites SET revoked_at = ? WHERE code = ? AND server_id = ?',
    )
      .bind(Math.floor(Date.now() / 1000), context.req.param('code'), serverId)
      .run();
    return context.body(null, 204);
  },
);

communities.delete(
  '/servers/:serverId/members/:userId',
  authenticate,
  requireCsrf,
  async (context) => {
    const serverId = context.req.param('serverId');
    const actorId = context.get('user').id;
    await requireServerPermission(context.env.DB, actorId, serverId, Permission.KICK_MEMBERS);
    const target = context.req.param('userId');
    const server = await context.env.DB.prepare('SELECT owner_id FROM servers WHERE id = ?')
      .bind(serverId)
      .first<{ owner_id: string }>();
    if (server?.owner_id === target)
      throw new ApiError('owner_protected', 'The owner cannot be kicked.', 403);
    await context.env.DB.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?')
      .bind(serverId, target)
      .run();
    await writeAuditLog(context.env.DB, serverId, actorId, 'member.kick', 'member', target);
    return context.body(null, 204);
  },
);

communities.post('/servers/:serverId/bans/:userId', authenticate, requireCsrf, async (context) => {
  const serverId = context.req.param('serverId');
  const actorId = context.get('user').id;
  await requireServerPermission(context.env.DB, actorId, serverId, Permission.BAN_MEMBERS);
  const input = await parseJson(context, moderationSchema);
  const target = context.req.param('userId');
  const server = await context.env.DB.prepare('SELECT owner_id FROM servers WHERE id = ?')
    .bind(serverId)
    .first<{ owner_id: string }>();
  if (server?.owner_id === target)
    throw new ApiError('owner_protected', 'The owner cannot be banned.', 403);
  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO bans (server_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)
         ON CONFLICT(server_id, user_id) DO UPDATE SET moderator_id = excluded.moderator_id,
           reason = excluded.reason, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).bind(serverId, target, actorId, input.reason),
    context.env.DB.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').bind(
      serverId,
      target,
    ),
  ]);
  await writeAuditLog(context.env.DB, serverId, actorId, 'member.ban', 'member', target, {
    reason: input.reason,
  });
  return context.json({ data: { banned: true } });
});

communities.delete(
  '/servers/:serverId/bans/:userId',
  authenticate,
  requireCsrf,
  async (context) => {
    const serverId = context.req.param('serverId');
    const actorId = context.get('user').id;
    await requireServerPermission(context.env.DB, actorId, serverId, Permission.BAN_MEMBERS);
    await context.env.DB.prepare('DELETE FROM bans WHERE server_id = ? AND user_id = ?')
      .bind(serverId, context.req.param('userId'))
      .run();
    await writeAuditLog(
      context.env.DB,
      serverId,
      actorId,
      'member.unban',
      'member',
      context.req.param('userId'),
    );
    return context.body(null, 204);
  },
);

communities.put(
  '/servers/:serverId/members/:userId/mute',
  authenticate,
  requireCsrf,
  async (context) => {
    const serverId = context.req.param('serverId');
    const actorId = context.get('user').id;
    await requireServerPermission(context.env.DB, actorId, serverId, Permission.MUTE_MEMBERS);
    const input = await parseJson(context, muteSchema);
    const until = input.seconds === 0 ? null : Math.floor(Date.now() / 1000) + input.seconds;
    const result = await context.env.DB.prepare(
      'UPDATE server_members SET muted_until = ? WHERE server_id = ? AND user_id = ?',
    )
      .bind(until, serverId, context.req.param('userId'))
      .run();
    if (result.meta.changes === 0) throw new ApiError('not_found', 'Member not found.', 404);
    await writeAuditLog(
      context.env.DB,
      serverId,
      actorId,
      'member.mute',
      'member',
      context.req.param('userId'),
      {
        until,
        reason: input.reason,
      },
    );
    return context.json({ data: { mutedUntil: until } });
  },
);

communities.put('/servers/:serverId/automod', authenticate, requireCsrf, async (context) => {
  const serverId = context.req.param('serverId');
  const userId = context.get('user').id;
  await requireServerPermission(context.env.DB, userId, serverId, Permission.MANAGE_SERVER);
  const input = await parseJson(context, automodSchema);
  await context.env.DB.prepare('UPDATE servers SET automod_json = ? WHERE id = ?')
    .bind(JSON.stringify({ ...input, bannedWords: [...new Set(input.bannedWords)] }), serverId)
    .run();
  await writeAuditLog(context.env.DB, serverId, userId, 'automod.update', 'server', serverId);
  return context.json({ data: input });
});

communities.get('/servers/:serverId/audit-log', authenticate, async (context) => {
  const serverId = context.req.param('serverId');
  await requireServerPermission(
    context.env.DB,
    context.get('user').id,
    serverId,
    Permission.VIEW_AUDIT_LOG,
  );
  const limit = boundedInteger(context.req.query('limit'), 50, 1, 100);
  const rows = await context.env.DB.prepare(
    `SELECT id, actor_id, action, target_type, target_id, metadata_json, created_at
       FROM audit_logs WHERE server_id = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(serverId, limit)
    .all();
  return context.json({ data: rows.results });
});

communities.get('/channels/:channelId/pins', authenticate, async (context) => {
  const channelId = context.req.param('channelId');
  const channel = await context.env.DB.prepare('SELECT server_id FROM channels WHERE id = ?')
    .bind(channelId)
    .first<{ server_id: string }>();
  if (!channel) throw new ApiError('not_found', 'Channel not found.', 404);
  await requireServerPermission(
    context.env.DB,
    context.get('user').id,
    channel.server_id,
    Permission.VIEW_CHANNEL,
    channelId,
  );
  const rows = await context.env.DB.prepare(
    `SELECT p.message_id, p.pinned_by, p.pinned_at, m.content, m.author_id
       FROM pinned_messages p JOIN messages m ON m.id = p.message_id
      WHERE p.channel_id = ? ORDER BY p.pinned_at DESC LIMIT 50`,
  )
    .bind(channelId)
    .all();
  return context.json({ data: rows.results });
});

communities.put(
  '/channels/:channelId/pins/:messageId',
  authenticate,
  requireCsrf,
  async (context) => {
    const channelId = context.req.param('channelId');
    const channel = await context.env.DB.prepare('SELECT server_id FROM channels WHERE id = ?')
      .bind(channelId)
      .first<{ server_id: string }>();
    if (!channel) throw new ApiError('not_found', 'Channel not found.', 404);
    const userId = context.get('user').id;
    await requireServerPermission(
      context.env.DB,
      userId,
      channel.server_id,
      Permission.MANAGE_MESSAGES,
      channelId,
    );
    await context.env.DB.prepare(
      `INSERT OR REPLACE INTO pinned_messages (channel_id, message_id, pinned_by)
     SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM messages WHERE id = ? AND channel_id = ?)`,
    )
      .bind(
        channelId,
        context.req.param('messageId'),
        userId,
        context.req.param('messageId'),
        channelId,
      )
      .run();
    await writeAuditLog(
      context.env.DB,
      channel.server_id,
      userId,
      'message.pin',
      'message',
      context.req.param('messageId'),
    );
    return context.json({ data: { pinned: true } });
  },
);

communities.delete(
  '/channels/:channelId/pins/:messageId',
  authenticate,
  requireCsrf,
  async (context) => {
    const channelId = context.req.param('channelId');
    const channel = await context.env.DB.prepare('SELECT server_id FROM channels WHERE id = ?')
      .bind(channelId)
      .first<{ server_id: string }>();
    if (!channel) throw new ApiError('not_found', 'Channel not found.', 404);
    await requireServerPermission(
      context.env.DB,
      context.get('user').id,
      channel.server_id,
      Permission.MANAGE_MESSAGES,
      channelId,
    );
    await context.env.DB.prepare(
      'DELETE FROM pinned_messages WHERE channel_id = ? AND message_id = ?',
    )
      .bind(channelId, context.req.param('messageId'))
      .run();
    return context.body(null, 204);
  },
);

export default communities;
