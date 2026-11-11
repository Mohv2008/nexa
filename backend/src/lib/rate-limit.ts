import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from './errors';
import { sha256 } from './crypto';

interface RateRow {
  count: number;
}

export async function clientFingerprint(context: Context<AppEnv>): Promise<string> {
  const address = context.req.header('CF-Connecting-IP') ?? 'local';
  return sha256(`${address}:${context.env.INTERNAL_SECRET}`);
}

export async function enforceRateLimit(
  context: Context<AppEnv>,
  action: string,
  identity: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const key = `${action}:${await sha256(identity)}`;
  const row = await context.env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count, expires_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(key, windowStart, windowStart + windowSeconds * 2)
    .first<RateRow>();

  if ((row?.count ?? limit + 1) > limit) {
    context.header('Retry-After', String(windowStart + windowSeconds - now));
    throw new ApiError('rate_limited', 'Too many requests. Please try again later.', 429);
  }

  // Opportunistic bounded cleanup; no timer or polling loop is needed.
  if (crypto.getRandomValues(new Uint8Array(1))[0]! < 3) {
    context.executionCtx.waitUntil(
      context.env.DB.prepare(
        'DELETE FROM rate_limits WHERE rowid IN (SELECT rowid FROM rate_limits WHERE expires_at < ? LIMIT 100)',
      )
        .bind(now)
        .run()
        .then(() => undefined),
    );
  }
}
