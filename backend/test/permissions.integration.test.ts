import { ALL_PERMISSIONS, Permission } from '@nexa/shared';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Bindings } from '../src/env';
import {
  requireConversationMember,
  requireServerPermission,
  resolveServerPermissions,
} from '../src/lib/permissions';

const bindings = env as unknown as Bindings;
const owner = 'usr_permission_owner';
const member = 'usr_permission_member';
const outsider = 'usr_permission_outsider';
const server = 'srv_permission_test';
const channel = 'chn_permission_test';
const everyone = 'rol_permission_everyone';
const moderator = 'rol_permission_moderator';

beforeAll(async () => {
  for (const [id, suffix] of [
    [owner, 'owner'],
    [member, 'member'],
    [outsider, 'outsider'],
  ]) {
    await bindings.DB.prepare(
      `INSERT INTO users (id, email, username, display_name, password_hash, birth_date)
       VALUES (?, ?, ?, ?, 'hash', '2000-01-01')`,
    )
      .bind(id, `${suffix}-permissions@example.com`, `${suffix}_permissions`, suffix)
      .run();
  }
  await bindings.DB.batch([
    bindings.DB.prepare(
      "INSERT INTO servers (id, owner_id, name) VALUES (?, ?, 'Permissions')",
    ).bind(server, owner),
    bindings.DB.prepare('INSERT INTO server_members (server_id, user_id) VALUES (?, ?)').bind(
      server,
      owner,
    ),
    bindings.DB.prepare('INSERT INTO server_members (server_id, user_id) VALUES (?, ?)').bind(
      server,
      member,
    ),
    bindings.DB.prepare(
      "INSERT INTO roles (id, server_id, name, permissions, is_everyone) VALUES (?, ?, '@everyone', ?, 1)",
    ).bind(everyone, server, Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES),
    bindings.DB.prepare(
      "INSERT INTO roles (id, server_id, name, permissions, position) VALUES (?, ?, 'mod', ?, 1)",
    ).bind(moderator, server, Permission.MANAGE_MESSAGES),
    bindings.DB.prepare(
      'INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)',
    ).bind(server, member, moderator),
    bindings.DB.prepare(
      "INSERT INTO channels (id, server_id, name, type) VALUES (?, ?, 'general', 'text')",
    ).bind(channel, server),
  ]);
});

describe('server-side authorization', () => {
  it('grants every permission only to the owner', async () => {
    const result = await resolveServerPermissions(bindings.DB, owner, server, channel);
    expect(result.mask).toBe(ALL_PERMISSIONS);
  });

  it('combines assigned roles and enforces missing permissions', async () => {
    const result = await resolveServerPermissions(bindings.DB, member, server);
    expect(result.mask & Permission.MANAGE_MESSAGES).toBe(Permission.MANAGE_MESSAGES);
    await expect(
      requireServerPermission(bindings.DB, member, server, Permission.BAN_MEMBERS),
    ).rejects.toMatchObject({ code: 'missing_permission', status: 403 });
  });

  it('applies everyone, role, and member channel overwrites in order', async () => {
    await bindings.DB.batch([
      bindings.DB.prepare(
        "INSERT INTO channel_overwrites (channel_id, target_id, target_type, deny_mask) VALUES (?, ?, 'role', ?)",
      ).bind(channel, everyone, Permission.SEND_MESSAGES),
      bindings.DB.prepare(
        "INSERT INTO channel_overwrites (channel_id, target_id, target_type, allow_mask) VALUES (?, ?, 'role', ?)",
      ).bind(channel, moderator, Permission.ADD_REACTIONS),
      bindings.DB.prepare(
        "INSERT INTO channel_overwrites (channel_id, target_id, target_type, allow_mask) VALUES (?, ?, 'member', ?)",
      ).bind(channel, member, Permission.SEND_MESSAGES),
    ]);
    const result = await resolveServerPermissions(bindings.DB, member, server, channel);
    expect(result.mask & Permission.SEND_MESSAGES).toBe(Permission.SEND_MESSAGES);
    expect(result.mask & Permission.ADD_REACTIONS).toBe(Permission.ADD_REACTIONS);
  });

  it('rejects absent communities, channels, members, and conversations', async () => {
    await expect(
      resolveServerPermissions(bindings.DB, member, 'srv_missing'),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(resolveServerPermissions(bindings.DB, outsider, server)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      resolveServerPermissions(bindings.DB, member, server, 'chn_missing'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      requireConversationMember(bindings.DB, member, 'cnv_missing'),
    ).rejects.toMatchObject({ status: 403 });
  });
});
