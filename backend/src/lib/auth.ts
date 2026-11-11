import { APP_CONFIG, newId, type UserSummary } from '@nexa/shared';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv, AuthUser } from '../env';
import { ApiError } from './errors';
import { noStore } from './http';
import { clientFingerprint } from './rate-limit';
import { randomToken, sha256, signAccessToken, verifyAccessToken } from './crypto';

export const ACCESS_COOKIE = 'nexa_access';
export const REFRESH_COOKIE = 'nexa_refresh';
export const CSRF_COOKIE = 'nexa_csrf';

interface AuthRow {
  id: string;
  session_id: string;
  csrf_hash: string;
  email: string;
  username: string;
  display_name: string;
  avatar_key: string | null;
  status: 'online' | 'idle' | 'dnd' | 'invisible';
  locale: 'en' | 'ar';
  email_verified_at: string | null;
  is_system_admin: number;
}

export interface SessionMaterial {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

function cookieOptions(context: Context<AppEnv>, maxAge: number, httpOnly: boolean) {
  const origin = context.req.header('Origin') ?? '';
  const nativeCrossSite = origin === 'tauri://localhost' || origin === 'https://tauri.localhost';
  return {
    httpOnly,
    secure: new URL(context.req.url).protocol === 'https:',
    sameSite: nativeCrossSite ? ('None' as const) : ('Strict' as const),
    path: '/',
    maxAge,
  };
}

export function publicUser(row: {
  id: string;
  username: string;
  display_name: string;
  avatar_key: string | null;
  status: string;
}): UserSummary {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_key ? `/v1/media/${encodeURIComponent(row.avatar_key)}` : null,
    status: row.status === 'invisible' ? 'offline' : (row.status as UserSummary['status']),
  };
}

function mapAuthUser(row: AuthRow): AuthUser {
  return {
    ...publicUser(row),
    email: row.email,
    emailVerified: row.email_verified_at !== null,
    locale: row.locale,
    sessionId: row.session_id,
    csrfHash: row.csrf_hash,
    systemAdmin: row.is_system_admin === 1,
  };
}

export function setSessionCookies(context: Context<AppEnv>, material: SessionMaterial): void {
  setCookie(
    context,
    ACCESS_COOKIE,
    material.accessToken,
    cookieOptions(context, APP_CONFIG.accessTokenSeconds, true),
  );
  setCookie(
    context,
    REFRESH_COOKIE,
    material.refreshToken,
    cookieOptions(context, APP_CONFIG.refreshTokenSeconds, true),
  );
  setCookie(
    context,
    CSRF_COOKIE,
    material.csrfToken,
    cookieOptions(context, APP_CONFIG.refreshTokenSeconds, false),
  );
  noStore(context.res.headers);
}

export function clearSessionCookies(context: Context<AppEnv>): void {
  const origin = context.req.header('Origin') ?? '';
  const nativeCrossSite = origin === 'tauri://localhost' || origin === 'https://tauri.localhost';
  const options = {
    path: '/',
    secure: new URL(context.req.url).protocol === 'https:',
    sameSite: nativeCrossSite ? ('None' as const) : ('Strict' as const),
  };
  deleteCookie(context, ACCESS_COOKIE, options);
  deleteCookie(context, REFRESH_COOKIE, options);
  deleteCookie(context, CSRF_COOKIE, options);
  noStore(context.res.headers);
}

export async function createSession(
  context: Context<AppEnv>,
  userId: string,
): Promise<SessionMaterial> {
  const now = Math.floor(Date.now() / 1000);
  const sessionId = newId('ses');
  const refreshToken = randomToken();
  const csrfToken = randomToken(24);
  const refreshExpiresAt = now + APP_CONFIG.refreshTokenSeconds;
  await context.env.DB.prepare(
    `INSERT INTO sessions
      (id, user_id, token_hash, csrf_hash, user_agent, ip_hash, expires_at, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      sessionId,
      userId,
      await sha256(refreshToken),
      await sha256(csrfToken),
      (context.req.header('User-Agent') ?? '').slice(0, 300),
      await clientFingerprint(context),
      refreshExpiresAt,
      now,
      now,
    )
    .run();
  return {
    accessToken: await signAccessToken(
      userId,
      sessionId,
      context.env.JWT_SECRET,
      APP_CONFIG.accessTokenSeconds,
      now,
    ),
    refreshToken,
    csrfToken,
    accessExpiresAt: now + APP_CONFIG.accessTokenSeconds,
    refreshExpiresAt,
  };
}

export async function resolveAuthentication(context: Context<AppEnv>): Promise<AuthUser | null> {
  const authorization = context.req.header('Authorization');
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice(7)
    : getCookie(context, ACCESS_COOKIE);
  if (!token) return null;
  const claims = await verifyAccessToken(token, context.env.JWT_SECRET);
  if (!claims) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = await context.env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.display_name, u.avatar_key, u.status, u.locale,
            u.email_verified_at, u.is_system_admin, s.id AS session_id, s.csrf_hash
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?
        AND u.deletion_requested_at IS NULL`,
  )
    .bind(claims.sid, claims.sub, now)
    .first<AuthRow>();
  return row ? mapAuthUser(row) : null;
}

export const authenticate: MiddlewareHandler<AppEnv> = async (context, next) => {
  const user = await resolveAuthentication(context);
  if (!user) throw new ApiError('invalid_session', 'Your session is invalid or expired.', 401);
  context.set('user', user);
  const now = Math.floor(Date.now() / 1000);
  context.executionCtx.waitUntil(
    context.env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
      .bind(now, user.sessionId)
      .run()
      .then(() => undefined),
  );
  await next();
};

export const requireCsrf: MiddlewareHandler<AppEnv> = async (context, next) => {
  if (context.req.header('Authorization')?.startsWith('Bearer ')) {
    await next();
    return;
  }
  const header = context.req.header('X-CSRF-Token');
  const cookie = getCookie(context, CSRF_COOKIE);
  if (
    !header ||
    !cookie ||
    header !== cookie ||
    (await sha256(header)) !== context.get('user').csrfHash
  ) {
    throw new ApiError('csrf_failed', 'CSRF validation failed.', 403);
  }
  await next();
};

export function getRefreshToken(context: Context<AppEnv>): string | undefined {
  return getCookie(context, REFRESH_COOKIE);
}
