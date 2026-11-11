import {
  ALL_PERMISSIONS,
  Permission,
  applyOverwrite,
  combineRolePermissions,
  hasPermission,
} from '@nexa/shared';
import { ApiError, forbidden, notFound } from './errors';

interface MembershipRow {
  owner_id: string;
  member_id: string | null;
  muted_until: number | null;
}

interface RoleRow {
  id: string;
  permissions: number;
  is_everyone: number;
}

interface OverwriteRow {
  target_id: string;
  target_type: 'role' | 'member';
  allow_mask: number;
  deny_mask: number;
}

export interface PermissionResult {
  mask: number;
  mutedUntil: number | null;
  roleIds: string[];
}

export async function resolveServerPermissions(
  database: D1Database,
  userId: string,
  serverId: string,
  channelId?: string,
): Promise<PermissionResult> {
  const membership = await database
    .prepare(
      `SELECT s.owner_id, sm.user_id AS member_id, sm.muted_until
         FROM servers s LEFT JOIN server_members sm ON sm.server_id = s.id AND sm.user_id = ?
        WHERE s.id = ?`,
    )
    .bind(userId, serverId)
    .first<MembershipRow>();
  if (!membership) notFound('Community not found.');
  if (!membership.member_id) forbidden('You are not a member of this community.');
  if (membership.owner_id === userId) {
    return { mask: ALL_PERMISSIONS, mutedUntil: membership.muted_until, roleIds: [] };
  }

  const roleResults = await database
    .prepare(
      `SELECT r.id, r.permissions, r.is_everyone
         FROM roles r
        WHERE r.server_id = ?
          AND (r.is_everyone = 1 OR r.id IN (
            SELECT role_id FROM member_roles WHERE server_id = ? AND user_id = ?
          ))`,
    )
    .bind(serverId, serverId, userId)
    .all<RoleRow>();
  const roles = roleResults.results;
  const roleIds = roles.map((role) => role.id);
  let mask = combineRolePermissions(roles.map((role) => role.permissions));
  if (hasPermission(mask, Permission.ADMINISTRATOR)) {
    return { mask: ALL_PERMISSIONS, mutedUntil: membership.muted_until, roleIds };
  }

  if (channelId) {
    const channel = await database
      .prepare('SELECT id FROM channels WHERE id = ? AND server_id = ?')
      .bind(channelId, serverId)
      .first();
    if (!channel) notFound('Channel not found.');
    const overwriteResults = await database
      .prepare(
        `SELECT target_id, target_type, allow_mask, deny_mask
           FROM channel_overwrites WHERE channel_id = ?`,
      )
      .bind(channelId)
      .all<OverwriteRow>();
    const overwrites = overwriteResults.results;
    const everyoneId = roles.find((role) => role.is_everyone === 1)?.id;
    const everyone = overwrites.find(
      (overwrite) => overwrite.target_type === 'role' && overwrite.target_id === everyoneId,
    );
    if (everyone) {
      mask = applyOverwrite(mask, { allow: everyone.allow_mask, deny: everyone.deny_mask });
    }
    const roleOverwrites = overwrites.filter(
      (overwrite) => overwrite.target_type === 'role' && roleIds.includes(overwrite.target_id),
    );
    if (roleOverwrites.length > 0) {
      mask = applyOverwrite(mask, {
        allow: combineRolePermissions(roleOverwrites.map((overwrite) => overwrite.allow_mask)),
        deny: combineRolePermissions(roleOverwrites.map((overwrite) => overwrite.deny_mask)),
      });
    }
    const member = overwrites.find(
      (overwrite) => overwrite.target_type === 'member' && overwrite.target_id === userId,
    );
    if (member) mask = applyOverwrite(mask, { allow: member.allow_mask, deny: member.deny_mask });
  }
  return { mask, mutedUntil: membership.muted_until, roleIds };
}

export async function requireServerPermission(
  database: D1Database,
  userId: string,
  serverId: string,
  permission: number,
  channelId?: string,
): Promise<PermissionResult> {
  const result = await resolveServerPermissions(database, userId, serverId, channelId);
  if (!hasPermission(result.mask, permission)) {
    throw new ApiError('missing_permission', 'You do not have the required permission.', 403, {
      permission,
    });
  }
  return result;
}

export async function requireConversationMember(
  database: D1Database,
  userId: string,
  conversationId: string,
): Promise<void> {
  const membership = await database
    .prepare(
      'SELECT 1 AS allowed FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL',
    )
    .bind(conversationId, userId)
    .first();
  if (!membership) forbidden('You are not a member of this conversation.');
}
