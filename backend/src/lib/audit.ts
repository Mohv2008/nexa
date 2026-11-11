import { newId } from '@nexa/shared';

export async function writeAuditLog(
  database: D1Database,
  serverId: string,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO audit_logs (id, server_id, actor_id, action, target_type, target_id, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(newId('aud'), serverId, actorId, action, targetType, targetId, JSON.stringify(metadata))
    .run();
}
