import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  Permission,
  applyOverwrite,
  combineRolePermissions,
  hasPermission,
} from './permissions';

describe('permissions', () => {
  it('combines role masks', () => {
    const mask = combineRolePermissions([Permission.VIEW_CHANNEL, Permission.SEND_MESSAGES]);
    expect(hasPermission(mask, Permission.VIEW_CHANNEL)).toBe(true);
    expect(hasPermission(mask, Permission.BAN_MEMBERS)).toBe(false);
  });

  it('applies deny then allow overwrites', () => {
    const base = Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES;
    const result = applyOverwrite(base, {
      deny: Permission.SEND_MESSAGES,
      allow: Permission.ADD_REACTIONS,
    });
    expect(hasPermission(result, Permission.SEND_MESSAGES)).toBe(false);
    expect(hasPermission(result, Permission.ADD_REACTIONS)).toBe(true);
  });

  it('makes administrator bypass overwrites', () => {
    expect(
      applyOverwrite(Permission.ADMINISTRATOR, {
        allow: 0,
        deny: ALL_PERMISSIONS,
      }),
    ).toBe(ALL_PERMISSIONS);
  });
});
