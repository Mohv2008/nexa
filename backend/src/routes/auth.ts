import {
  APP_CONFIG,
  isAtLeastAge,
  loginSchema,
  newId,
  passwordSchema,
  profileSchema,
  registerSchema,
} from '@nexa/shared';
import { getCookie } from 'hono/cookie';
import { Hono } from 'hono';
import * as v from 'valibot';
import type { AppEnv } from '../env';
import {
  REFRESH_COOKIE,
  authenticate,
  clearSessionCookies,
  createSession,
  getRefreshToken,
  publicUser,
  requireCsrf,
  setSessionCookies,
} from '../lib/auth';
import {
  base32Encode,
  decryptText,
  encryptText,
  hashPassword,
  isBreachedPassword,
  randomBytes,
  randomToken,
  sha256,
  signAccessToken,
  verifyPassword,
  verifyTotp,
} from '../lib/crypto';
import { sendAuthLink } from '../lib/email';
import { ApiError } from '../lib/errors';
import { noStore } from '../lib/http';
import { clientFingerprint, enforceRateLimit } from '../lib/rate-limit';
import { parseJson } from '../lib/validation';

const auth = new Hono<AppEnv>();

interface UserRow {
  id: string;
  email: string;
  username: string;
  display_name: string;
  password_hash: string;
  avatar_key: string | null;
  status: 'online' | 'idle' | 'dnd' | 'invisible';
  locale: 'en' | 'ar';
  bio: string;
  email_verified_at: string | null;
  totp_enabled: number;
  totp_secret_cipher: string | null;
  failed_login_count: number;
  locked_until: number | null;
  created_at: string;
}

interface RefreshRow {
  id: string;
  user_id: string;
  token_hash: string;
  previous_token_hash: string | null;
  expires_at: number;
  revoked_at: number | null;
}

interface AuthTokenRow {
  id: string;
  user_id: string;
  email: string;
  token_hash: string;
  payload_cipher: string | null;
  expires_at: number;
  used_at: number | null;
}

const emailSchema = v.object({
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email(), v.maxLength(254)),
});
const tokenSchema = v.object({ token: v.pipe(v.string(), v.minLength(32), v.maxLength(200)) });
const resetSchema = v.object({
  token: v.pipe(v.string(), v.minLength(32), v.maxLength(200)),
  password: passwordSchema,
});
const totpEnableSchema = v.object({
  setupToken: v.pipe(v.string(), v.minLength(32), v.maxLength(200)),
  code: v.pipe(v.string(), v.regex(/^\d{6}$/u)),
});
const totpDisableSchema = v.object({
  password: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  code: v.pipe(v.string(), v.regex(/^\d{6}$/u)),
});

function accountJson(row: UserRow) {
  return {
    ...publicUser(row),
    email: row.email,
    emailVerified: row.email_verified_at !== null,
    bio: row.bio,
    locale: row.locale,
    totpEnabled: row.totp_enabled === 1,
    createdAt: row.created_at,
  };
}

async function createAuthToken(
  database: D1Database,
  userId: string,
  purpose: 'verify_email' | 'reset_password',
  lifetimeSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = randomToken();
  await database.batch([
    database
      .prepare(
        'UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL',
      )
      .bind(now, userId, purpose),
    database
      .prepare(
        `INSERT INTO auth_tokens (id, user_id, token_hash, purpose, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(newId('atk'), userId, await sha256(token), purpose, now + lifetimeSeconds, now),
  ]);
  return token;
}

auth.post('/register', async (context) => {
  const input = await parseJson(context, registerSchema);
  const fingerprint = await clientFingerprint(context);
  await enforceRateLimit(context, 'register-ip', fingerprint, 5, 60 * 60);
  await enforceRateLimit(context, 'register-email', input.email, 3, 60 * 60);
  if (!isAtLeastAge(input.birthDate, APP_CONFIG.minAge)) {
    throw new ApiError('age_requirement', `You must be at least ${APP_CONFIG.minAge}.`, 400);
  }
  if (context.env.HIBP_ENABLED !== 'false') {
    let breached: boolean;
    try {
      breached = await isBreachedPassword(input.password);
    } catch {
      throw new ApiError(
        'password_check_unavailable',
        'Password safety check is unavailable.',
        503,
      );
    }
    if (breached) {
      throw new ApiError(
        'breached_password',
        'Choose a password that has not appeared in a known data breach.',
        400,
      );
    }
  }
  const existing = await context.env.DB.prepare(
    'SELECT 1 AS found FROM users WHERE email = ? OR username = ? LIMIT 1',
  )
    .bind(input.email, input.username)
    .first();
  if (existing) {
    throw new ApiError(
      'registration_failed',
      'An account could not be created with those details.',
      409,
    );
  }
  const userId = newId('usr');
  try {
    await context.env.DB.prepare(
      `INSERT INTO users (id, email, username, display_name, password_hash, birth_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        userId,
        input.email,
        input.username,
        input.displayName,
        await hashPassword(input.password),
        input.birthDate,
      )
      .run();
  } catch {
    throw new ApiError(
      'registration_failed',
      'An account could not be created with those details.',
      409,
    );
  }
  const verificationToken = await createAuthToken(
    context.env.DB,
    userId,
    'verify_email',
    24 * 60 * 60,
  );
  context.executionCtx.waitUntil(
    sendAuthLink(context.env, input.email, 'verify', verificationToken).then(() => undefined),
  );
  const session = await createSession(context, userId);
  setSessionCookies(context, session);
  return context.json(
    {
      data: {
        user: {
          id: userId,
          username: input.username,
          displayName: input.displayName,
          avatarUrl: null,
          status: 'online',
          email: input.email,
          emailVerified: false,
          locale: 'en',
        },
        csrfToken: session.csrfToken,
        accessExpiresAt: session.accessExpiresAt,
      },
    },
    201,
  );
});

auth.post('/login', async (context) => {
  const input = await parseJson(context, loginSchema);
  const identifier = input.identifier.toLowerCase();
  const fingerprint = await clientFingerprint(context);
  await enforceRateLimit(context, 'login-ip', fingerprint, 15, 15 * 60);
  await enforceRateLimit(context, 'login-account', identifier, 8, 15 * 60);
  const row = await context.env.DB.prepare(
    `SELECT id, email, username, display_name, password_hash, avatar_key, status, locale, bio,
            email_verified_at, totp_enabled, totp_secret_cipher, failed_login_count, locked_until, created_at
       FROM users WHERE (email = ? OR username = ?) AND deletion_requested_at IS NULL LIMIT 1`,
  )
    .bind(identifier, identifier)
    .first<UserRow>();
  const validPassword = row
    ? await verifyPassword(input.password, row.password_hash)
    : Boolean(await hashPassword(input.password));
  const now = Math.floor(Date.now() / 1000);
  if (!row || !validPassword || (row.locked_until !== null && row.locked_until > now)) {
    if (row && (row.locked_until === null || row.locked_until <= now)) {
      const failures = row.failed_login_count + 1;
      const lockSeconds = failures >= 5 ? Math.min(60 * 60, 2 ** (failures - 5) * 60) : null;
      await context.env.DB.prepare(
        'UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?',
      )
        .bind(failures, lockSeconds ? now + lockSeconds : null, row.id)
        .run();
    }
    throw new ApiError('login_failed', 'The email/username or password is incorrect.', 401);
  }
  if (row.totp_enabled === 1) {
    if (!input.totp || !row.totp_secret_cipher) {
      throw new ApiError('totp_required', 'A two-factor authentication code is required.', 401);
    }
    const secret = await decryptText(row.totp_secret_cipher, context.env.DATA_ENCRYPTION_KEY);
    if (!secret || !(await verifyTotp(secret, input.totp))) {
      throw new ApiError('login_failed', 'The email/username or password is incorrect.', 401);
    }
  }
  await context.env.DB.prepare(
    'UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?',
  )
    .bind(row.id)
    .run();
  const session = await createSession(context, row.id);
  setSessionCookies(context, session);
  return context.json({
    data: {
      user: accountJson(row),
      csrfToken: session.csrfToken,
      accessExpiresAt: session.accessExpiresAt,
    },
  });
});

auth.post('/refresh', async (context) => {
  const refreshToken = getRefreshToken(context);
  if (!refreshToken) throw new ApiError('invalid_session', 'Refresh token is missing.', 401);
  const tokenHash = await sha256(refreshToken);
  const row = await context.env.DB.prepare(
    `SELECT id, user_id, token_hash, previous_token_hash, expires_at, revoked_at
       FROM sessions WHERE token_hash = ? OR previous_token_hash = ? LIMIT 1`,
  )
    .bind(tokenHash, tokenHash)
    .first<RefreshRow>();
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.revoked_at !== null || row.expires_at <= now) {
    clearSessionCookies(context);
    throw new ApiError('invalid_session', 'Refresh token is invalid or expired.', 401);
  }
  if (row.previous_token_hash === tokenHash) {
    await context.env.DB.prepare(
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
    )
      .bind(now, row.user_id)
      .run();
    clearSessionCookies(context);
    throw new ApiError('refresh_reuse', 'Session reuse was detected. Sign in again.', 401);
  }
  const nextRefresh = randomToken();
  const csrfToken = randomToken(24);
  const result = await context.env.DB.prepare(
    `UPDATE sessions
        SET previous_token_hash = token_hash, token_hash = ?, csrf_hash = ?, rotated_at = ?, last_seen_at = ?
      WHERE id = ? AND token_hash = ? AND revoked_at IS NULL`,
  )
    .bind(await sha256(nextRefresh), await sha256(csrfToken), now, now, row.id, tokenHash)
    .run();
  if (result.meta.changes !== 1) {
    await context.env.DB.prepare(
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
    )
      .bind(now, row.user_id)
      .run();
    clearSessionCookies(context);
    throw new ApiError('refresh_reuse', 'Session reuse was detected. Sign in again.', 401);
  }
  const session = {
    accessToken: await signAccessToken(
      row.user_id,
      row.id,
      context.env.JWT_SECRET,
      APP_CONFIG.accessTokenSeconds,
      now,
    ),
    refreshToken: nextRefresh,
    csrfToken,
    accessExpiresAt: now + APP_CONFIG.accessTokenSeconds,
    refreshExpiresAt: row.expires_at,
  };
  setSessionCookies(context, session);
  return context.json({
    data: { csrfToken: session.csrfToken, accessExpiresAt: session.accessExpiresAt },
  });
});

auth.post('/logout', authenticate, requireCsrf, async (context) => {
  const now = Math.floor(Date.now() / 1000);
  await context.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?')
    .bind(now, context.get('user').sessionId)
    .run();
  clearSessionCookies(context);
  return context.body(null, 204);
});

auth.get('/me', authenticate, async (context) => {
  const row = await context.env.DB.prepare(
    `SELECT id, email, username, display_name, password_hash, avatar_key, status, locale, bio,
            email_verified_at, totp_enabled, totp_secret_cipher, failed_login_count, locked_until, created_at
       FROM users WHERE id = ?`,
  )
    .bind(context.get('user').id)
    .first<UserRow>();
  if (!row) throw new ApiError('not_found', 'Account not found.', 404);
  noStore(context.res.headers);
  return context.json({ data: accountJson(row) });
});

auth.patch('/me', authenticate, requireCsrf, async (context) => {
  const input = await parseJson(context, profileSchema);
  const current = await context.env.DB.prepare(
    'SELECT display_name, bio, status, locale, avatar_key FROM users WHERE id = ?',
  )
    .bind(context.get('user').id)
    .first<{
      display_name: string;
      bio: string;
      status: string;
      locale: string;
      avatar_key: string | null;
    }>();
  if (!current) throw new ApiError('not_found', 'Account not found.', 404);
  if (input.avatarKey) {
    const owned = await context.env.DB.prepare(
      'SELECT 1 AS owned FROM uploads WHERE object_key = ? AND owner_id = ?',
    )
      .bind(input.avatarKey, context.get('user').id)
      .first();
    if (!owned) throw new ApiError('invalid_upload', 'Avatar upload was not found.', 400);
  }
  await context.env.DB.prepare(
    `UPDATE users SET display_name = ?, bio = ?, status = ?, locale = ?, avatar_key = ?,
                      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`,
  )
    .bind(
      input.displayName ?? current.display_name,
      input.bio ?? current.bio,
      input.status ?? current.status,
      input.locale ?? current.locale,
      input.avatarKey === undefined ? current.avatar_key : input.avatarKey,
      context.get('user').id,
    )
    .run();
  return context.json({ data: { updated: true } });
});

auth.post('/email/verify/request', authenticate, requireCsrf, async (context) => {
  const user = context.get('user');
  await enforceRateLimit(context, 'verify-email', user.id, 3, 60 * 60);
  if (!user.emailVerified) {
    const token = await createAuthToken(context.env.DB, user.id, 'verify_email', 24 * 60 * 60);
    context.executionCtx.waitUntil(
      sendAuthLink(context.env, user.email, 'verify', token).then(() => undefined),
    );
  }
  return context.json({ data: { accepted: true } }, 202);
});

auth.post('/email/verify', async (context) => {
  const input = await parseJson(context, tokenSchema);
  const now = Math.floor(Date.now() / 1000);
  const row = await context.env.DB.prepare(
    `SELECT t.id, t.user_id, t.token_hash, t.payload_cipher, t.expires_at, t.used_at, u.email
       FROM auth_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.purpose = 'verify_email' LIMIT 1`,
  )
    .bind(await sha256(input.token))
    .first<AuthTokenRow>();
  if (!row || row.used_at !== null || row.expires_at <= now) {
    throw new ApiError('invalid_token', 'Verification link is invalid or expired.', 400);
  }
  await context.env.DB.batch([
    context.env.DB.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').bind(now, row.id),
    context.env.DB.prepare(
      "UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    ).bind(row.user_id),
  ]);
  return context.json({ data: { verified: true } });
});

auth.post('/password/reset/request', async (context) => {
  const input = await parseJson(context, emailSchema);
  await enforceRateLimit(context, 'reset-ip', await clientFingerprint(context), 5, 60 * 60);
  await enforceRateLimit(context, 'reset-email', input.email, 3, 60 * 60);
  const user = await context.env.DB.prepare('SELECT id, email FROM users WHERE email = ?')
    .bind(input.email)
    .first<{ id: string; email: string }>();
  if (user) {
    const token = await createAuthToken(context.env.DB, user.id, 'reset_password', 30 * 60);
    context.executionCtx.waitUntil(
      sendAuthLink(context.env, user.email, 'reset', token).then(() => undefined),
    );
  }
  return context.json({ data: { accepted: true } }, 202);
});

auth.post('/password/reset', async (context) => {
  const input = await parseJson(context, resetSchema);
  await enforceRateLimit(context, 'reset-confirm', await clientFingerprint(context), 5, 60 * 60);
  if (context.env.HIBP_ENABLED !== 'false' && (await isBreachedPassword(input.password))) {
    throw new ApiError('breached_password', 'Choose a password not found in a known breach.', 400);
  }
  const now = Math.floor(Date.now() / 1000);
  const row = await context.env.DB.prepare(
    `SELECT t.id, t.user_id, t.token_hash, t.payload_cipher, t.expires_at, t.used_at, u.email
       FROM auth_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.purpose = 'reset_password' LIMIT 1`,
  )
    .bind(await sha256(input.token))
    .first<AuthTokenRow>();
  if (!row || row.used_at !== null || row.expires_at <= now) {
    throw new ApiError('invalid_token', 'Reset link is invalid or expired.', 400);
  }
  await context.env.DB.batch([
    context.env.DB.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').bind(now, row.id),
    context.env.DB.prepare(
      'UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?',
    ).bind(await hashPassword(input.password), row.user_id),
    context.env.DB.prepare(
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
    ).bind(now, row.user_id),
  ]);
  clearSessionCookies(context);
  return context.json({ data: { reset: true } });
});

auth.post('/totp/setup', authenticate, requireCsrf, async (context) => {
  const user = context.get('user');
  await enforceRateLimit(context, 'totp-setup', user.id, 5, 60 * 60);
  const secret = base32Encode(randomBytes(20));
  const setupToken = randomToken();
  const now = Math.floor(Date.now() / 1000);
  await context.env.DB.prepare(
    `INSERT INTO auth_tokens (id, user_id, token_hash, purpose, payload_cipher, expires_at, created_at)
     VALUES (?, ?, ?, 'totp_setup', ?, ?, ?)`,
  )
    .bind(
      newId('atk'),
      user.id,
      await sha256(setupToken),
      await encryptText(secret, context.env.DATA_ENCRYPTION_KEY),
      now + 10 * 60,
      now,
    )
    .run();
  const label = encodeURIComponent(`NEXA:${user.email}`);
  const issuer = encodeURIComponent('NEXA');
  return context.json({
    data: {
      secret,
      setupToken,
      otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
    },
  });
});

auth.post('/totp/enable', authenticate, requireCsrf, async (context) => {
  const input = await parseJson(context, totpEnableSchema);
  const now = Math.floor(Date.now() / 1000);
  const row = await context.env.DB.prepare(
    `SELECT id, user_id, payload_cipher, expires_at FROM auth_tokens
      WHERE token_hash = ? AND purpose = 'totp_setup' AND used_at IS NULL LIMIT 1`,
  )
    .bind(await sha256(input.setupToken))
    .first<{ id: string; user_id: string; payload_cipher: string; expires_at: number }>();
  if (!row || row.user_id !== context.get('user').id || row.expires_at <= now) {
    throw new ApiError('invalid_token', '2FA setup has expired.', 400);
  }
  const secret = await decryptText(row.payload_cipher, context.env.DATA_ENCRYPTION_KEY);
  if (!secret || !(await verifyTotp(secret, input.code))) {
    throw new ApiError('invalid_totp', 'The authentication code is invalid.', 400);
  }
  await context.env.DB.batch([
    context.env.DB.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').bind(now, row.id),
    context.env.DB.prepare(
      'UPDATE users SET totp_enabled = 1, totp_secret_cipher = ? WHERE id = ?',
    ).bind(row.payload_cipher, row.user_id),
  ]);
  return context.json({ data: { enabled: true } });
});

auth.post('/totp/disable', authenticate, requireCsrf, async (context) => {
  const input = await parseJson(context, totpDisableSchema);
  const row = await context.env.DB.prepare(
    'SELECT password_hash, totp_secret_cipher FROM users WHERE id = ? AND totp_enabled = 1',
  )
    .bind(context.get('user').id)
    .first<{ password_hash: string; totp_secret_cipher: string }>();
  const secret = row
    ? await decryptText(row.totp_secret_cipher, context.env.DATA_ENCRYPTION_KEY)
    : null;
  if (
    !row ||
    !secret ||
    !(await verifyPassword(input.password, row.password_hash)) ||
    !(await verifyTotp(secret, input.code))
  ) {
    throw new ApiError('verification_failed', 'Password or authentication code is invalid.', 401);
  }
  await context.env.DB.prepare(
    'UPDATE users SET totp_enabled = 0, totp_secret_cipher = NULL WHERE id = ?',
  )
    .bind(context.get('user').id)
    .run();
  return context.json({ data: { enabled: false } });
});

auth.get('/sessions', authenticate, async (context) => {
  const rows = await context.env.DB.prepare(
    `SELECT id, user_agent, created_at, last_seen_at, expires_at
       FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY last_seen_at DESC LIMIT 100`,
  )
    .bind(context.get('user').id, Math.floor(Date.now() / 1000))
    .all<{
      id: string;
      user_agent: string;
      created_at: number;
      last_seen_at: number;
      expires_at: number;
    }>();
  return context.json({
    data: rows.results.map((session) => ({
      id: session.id,
      userAgent: session.user_agent,
      createdAt: new Date(session.created_at * 1000).toISOString(),
      lastSeenAt: new Date(session.last_seen_at * 1000).toISOString(),
      expiresAt: new Date(session.expires_at * 1000).toISOString(),
      current: session.id === context.get('user').sessionId,
    })),
  });
});

auth.delete('/sessions/:sessionId', authenticate, requireCsrf, async (context) => {
  const sessionId = context.req.param('sessionId');
  const now = Math.floor(Date.now() / 1000);
  const result = await context.env.DB.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
  )
    .bind(now, sessionId, context.get('user').id)
    .run();
  if (result.meta.changes === 0) throw new ApiError('not_found', 'Session not found.', 404);
  if (sessionId === context.get('user').sessionId) clearSessionCookies(context);
  return context.body(null, 204);
});

auth.delete('/sessions', authenticate, requireCsrf, async (context) => {
  await context.env.DB.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
  )
    .bind(Math.floor(Date.now() / 1000), context.get('user').id)
    .run();
  clearSessionCookies(context);
  return context.body(null, 204);
});

auth.get('/export', authenticate, async (context) => {
  const userId = context.get('user').id;
  const [user, posts, comments, follows, memberships, messages] = await context.env.DB.batch([
    context.env.DB.prepare(
      'SELECT id, email, username, display_name, birth_date, bio, locale, created_at FROM users WHERE id = ?',
    ).bind(userId),
    context.env.DB.prepare(
      'SELECT id, body, visibility, created_at, edited_at FROM posts WHERE author_id = ?',
    ).bind(userId),
    context.env.DB.prepare(
      'SELECT id, post_id, body, created_at, edited_at FROM comments WHERE author_id = ?',
    ).bind(userId),
    context.env.DB.prepare(
      'SELECT follower_id, following_id, status, created_at FROM follows WHERE follower_id = ? OR following_id = ?',
    ).bind(userId, userId),
    context.env.DB.prepare(
      'SELECT server_id, nickname, joined_at FROM server_members WHERE user_id = ?',
    ).bind(userId),
    context.env.DB.prepare(
      'SELECT id, channel_id, conversation_id, content, created_at, edited_at FROM messages WHERE author_id = ?',
    ).bind(userId),
  ]);
  noStore(context.res.headers);
  context.header('Content-Disposition', 'attachment; filename="nexa-export.json"');
  return context.json({
    exportedAt: new Date().toISOString(),
    user: user!.results,
    posts: posts!.results,
    comments: comments!.results,
    follows: follows!.results,
    memberships: memberships!.results,
    messages: messages!.results,
  });
});

auth.delete('/me', authenticate, requireCsrf, async (context) => {
  const passwordInput = await parseJson(
    context,
    v.object({ password: v.pipe(v.string(), v.minLength(1), v.maxLength(128)) }),
  );
  const userId = context.get('user').id;
  const row = await context.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(userId)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(passwordInput.password, row.password_hash))) {
    throw new ApiError('verification_failed', 'Password is invalid.', 401);
  }
  const uploads = await context.env.DB.prepare('SELECT object_key FROM uploads WHERE owner_id = ?')
    .bind(userId)
    .all<{ object_key: string }>();
  await Promise.all(uploads.results.map((upload) => context.env.MEDIA.delete(upload.object_key)));
  await context.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
  clearSessionCookies(context);
  return context.body(null, 204);
});

// Avoid browser/proxy caching of every authentication response.
auth.use('*', async (context, next) => {
  await next();
  noStore(context.res.headers);
});

export default auth;
