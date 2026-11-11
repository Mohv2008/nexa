import { newId } from '@nexa/shared';

export async function createNotification(
  database: D1Database,
  userId: string,
  actorId: string | null,
  type: string,
  entityId: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  if (actorId === userId) return;
  await database
    .prepare(
      `INSERT INTO notifications (id, user_id, actor_id, type, entity_id, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(newId('ntf'), userId, actorId, type, entityId, JSON.stringify(payload))
    .run();
}

export async function notifyMentionedUsers(
  database: D1Database,
  text: string,
  actorId: string,
  type: string,
  entityId: string,
): Promise<void> {
  const usernames = [
    ...new Set(
      [...text.matchAll(/(^|\s)@([a-z0-9_]{3,24})\b/giu)].map((match) =>
        (match[2] ?? '').toLowerCase(),
      ),
    ),
  ].slice(0, 20);
  if (usernames.length === 0) return;
  const placeholders = usernames.map(() => '?').join(',');
  const users = await database
    .prepare(`SELECT id FROM users WHERE username IN (${placeholders})`)
    .bind(...usernames)
    .all<{ id: string }>();
  await Promise.all(
    users.results.map((user) => createNotification(database, user.id, actorId, type, entityId, {})),
  );
}
