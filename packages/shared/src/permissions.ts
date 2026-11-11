export const Permission = Object.freeze({
  VIEW_CHANNEL: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  MANAGE_MESSAGES: 1 << 2,
  EMBED_LINKS: 1 << 3,
  ATTACH_FILES: 1 << 4,
  ADD_REACTIONS: 1 << 5,
  MENTION_EVERYONE: 1 << 6,
  CONNECT_VOICE: 1 << 7,
  SPEAK_VOICE: 1 << 8,
  MUTE_MEMBERS: 1 << 9,
  KICK_MEMBERS: 1 << 10,
  BAN_MEMBERS: 1 << 11,
  MANAGE_CHANNELS: 1 << 12,
  MANAGE_ROLES: 1 << 13,
  MANAGE_SERVER: 1 << 14,
  CREATE_INVITES: 1 << 15,
  VIEW_AUDIT_LOG: 1 << 16,
  MANAGE_THREADS: 1 << 17,
  ADMINISTRATOR: 1 << 18,
} as const);

export type PermissionName = keyof typeof Permission;

export const ALL_PERMISSIONS = Object.values(Permission).reduce(
  (mask, permission) => mask | permission,
  0,
);

export const DEFAULT_MEMBER_PERMISSIONS =
  Permission.VIEW_CHANNEL |
  Permission.SEND_MESSAGES |
  Permission.EMBED_LINKS |
  Permission.ATTACH_FILES |
  Permission.ADD_REACTIONS |
  Permission.CONNECT_VOICE |
  Permission.SPEAK_VOICE |
  Permission.CREATE_INVITES;

export function hasPermission(mask: number, permission: number): boolean {
  return (mask & Permission.ADMINISTRATOR) !== 0 || (mask & permission) === permission;
}

export interface PermissionOverwrite {
  allow: number;
  deny: number;
}

/** Deny is applied before allow, matching common community-platform semantics. */
export function applyOverwrite(base: number, overwrite: PermissionOverwrite): number {
  if (hasPermission(base, Permission.ADMINISTRATOR)) return ALL_PERMISSIONS;
  return (base & ~overwrite.deny) | overwrite.allow;
}

export function combineRolePermissions(roleMasks: readonly number[]): number {
  return roleMasks.reduce((result, mask) => result | mask, 0);
}
