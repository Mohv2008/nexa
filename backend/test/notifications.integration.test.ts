import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Bindings } from '../src/env';
import { createNotification, notifyMentionedUsers } from '../src/lib/notifications';

const bindings = env as unknown as Bindings;
const actor = 'usr_notification_actor';
const target = 'usr_notification_target';

beforeAll(async () => {
  for (const [id, suffix] of [
    [actor, 'actor'],
    [target, 'target'],
  ]) {
    await bindings.DB.prepare(
      `INSERT INTO users (id, email, username, display_name, password_hash, birth_date)
       VALUES (?, ?, ?, ?, 'hash', '2000-01-01')`,
    )
      .bind(id, `${suffix}-notification@example.com`, `${suffix}_notification`, suffix)
      .run();
  }
});

describe('notifications', () => {
  it('does not notify an actor about their own action', async () => {
    await createNotification(bindings.DB, actor, actor, 'self', null);
    const count = await bindings.DB.prepare(
      'SELECT count(*) AS total FROM notifications WHERE user_id = ?',
    )
      .bind(actor)
      .first<{ total: number }>();
    expect(count?.total).toBe(0);
  });

  it('creates structured notifications and resolves bounded mentions', async () => {
    await createNotification(bindings.DB, target, actor, 'follow', actor, { source: 'test' });
    await notifyMentionedUsers(
      bindings.DB,
      'hello @target_notification and @missing_user',
      actor,
      'mention',
      'msg_notification',
    );
    await notifyMentionedUsers(bindings.DB, 'no mentions', actor, 'mention', 'msg_none');
    const rows = await bindings.DB.prepare(
      'SELECT type, payload_json FROM notifications WHERE user_id = ? ORDER BY created_at',
    )
      .bind(target)
      .all<{ type: string; payload_json: string }>();
    expect(rows.results.map((row) => row.type)).toEqual(['follow', 'mention']);
    expect(JSON.parse(rows.results[0]!.payload_json)).toEqual({ source: 'test' });
  });
});
