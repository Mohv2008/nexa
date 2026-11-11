import type { Bindings } from '../env';
import { toBase64Url } from './crypto';

const encoder = new TextEncoder();

function pemBytes(value: string): ArrayBuffer {
  const normalized = value.replace(/\\n/g, '\n');
  const base64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/gu, '')
    .replace(/-----END PRIVATE KEY-----/gu, '')
    .replace(/\s/gu, '');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

async function serviceAccountJwt(env: Bindings): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = toBase64Url(
    encoder.encode(
      JSON.stringify({
        iss: env.FIREBASE_CLIENT_EMAIL,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(env.FIREBASE_PRIVATE_KEY!),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

async function accessToken(env: Bindings): Promise<string | null> {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    return null;
  }
  const edgeCache = (caches as CacheStorage & { default: Cache }).default;
  const cacheKey = new Request(`https://fcm-token.nexa.invalid/${env.FIREBASE_PROJECT_ID}`);
  const cached = await edgeCache.match(cacheKey);
  if (cached) return cached.text();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await serviceAccountJwt(env),
    }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) return null;
  const cacheResponse = new Response(payload.access_token, {
    headers: { 'Cache-Control': `max-age=${Math.max(60, (payload.expires_in ?? 3600) - 300)}` },
  });
  await edgeCache.put(cacheKey, cacheResponse);
  return payload.access_token;
}

export async function sendAndroidPush(
  env: Bindings,
  userId: string,
  title: string,
  body: string,
  data: Record<string, string> = {},
): Promise<void> {
  const bearer = await accessToken(env);
  if (!bearer || !env.FIREBASE_PROJECT_ID) return;
  const tokens = await env.DB.prepare('SELECT token FROM device_tokens WHERE user_id = ?')
    .bind(userId)
    .all<{ token: string }>();
  await Promise.all(
    tokens.results.map(async ({ token }) => {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID!)}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${bearer}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title, body },
              data,
              android: {
                priority: 'high',
                notification: { channel_id: 'nexa_messages', tag: data.entityId ?? 'nexa' },
              },
            },
          }),
        },
      );
      if (response.status === 404 || response.status === 410) {
        await env.DB.prepare('DELETE FROM device_tokens WHERE token = ?').bind(token).run();
      }
    }),
  );
}
