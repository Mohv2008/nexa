import { Hono } from 'hono';
import * as v from 'valibot';
import type { AppEnv } from '../env';
import { authenticate, requireCsrf } from '../lib/auth';
import { ApiError } from '../lib/errors';
import { boundedInteger, parseJson } from '../lib/validation';

const admin = new Hono<AppEnv>();

admin.use('*', authenticate, async (context, next) => {
  if (!context.get('user').systemAdmin) {
    throw new ApiError('forbidden', 'System administrator access is required.', 403);
  }
  await next();
});

admin.get('/admin/summary', async (context) => {
  const results = await context.env.DB.batch([
    context.env.DB.prepare('SELECT count(*) AS count FROM users'),
    context.env.DB.prepare('SELECT count(*) AS count FROM servers'),
    context.env.DB.prepare('SELECT count(*) AS count FROM messages'),
    context.env.DB.prepare(
      "SELECT count(*) AS count FROM reports WHERE status IN ('open', 'reviewing')",
    ),
  ]);
  const count = (index: number) =>
    Number((results[index]?.results[0] as { count?: unknown } | undefined)?.count ?? 0);
  return context.json({
    data: {
      users: count(0),
      communities: count(1),
      messages: count(2),
      openReports: count(3),
    },
  });
});

admin.get('/admin/reports', async (context) => {
  const limit = boundedInteger(context.req.query('limit'), 50, 1, 100);
  const status = context.req.query('status') ?? 'open';
  if (!['open', 'reviewing', 'resolved', 'dismissed'].includes(status)) {
    throw new ApiError('invalid_status', 'Report status is invalid.', 400);
  }
  const rows = await context.env.DB.prepare(
    `SELECT id, reporter_id, target_type, target_id, reason, details, status,
            assigned_to, created_at, resolved_at
       FROM reports WHERE status = ? ORDER BY created_at ASC LIMIT ?`,
  )
    .bind(status, limit)
    .all();
  return context.json({ data: rows.results });
});

admin.patch('/admin/reports/:reportId', requireCsrf, async (context) => {
  const input = await parseJson(
    context,
    v.object({ status: v.picklist(['reviewing', 'resolved', 'dismissed']) }),
  );
  const userId = context.get('user').id;
  const result = await context.env.DB.prepare(
    `UPDATE reports SET status = ?, assigned_to = ?,
       resolved_at = CASE WHEN ? IN ('resolved', 'dismissed')
                          THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END
      WHERE id = ?`,
  )
    .bind(input.status, userId, input.status, context.req.param('reportId'))
    .run();
  if (result.meta.changes === 0) throw new ApiError('not_found', 'Report not found.', 404);
  return context.json({ data: { updated: true } });
});

export default admin;
