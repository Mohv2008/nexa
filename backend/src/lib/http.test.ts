import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv, Bindings } from '../env';
import { ApiError } from './errors';
import { allowedOrigins, corsAndOrigin, noStore, requestContext, securityHeaders } from './http';

const env = {
  ALLOWED_ORIGINS: 'https://app.test, https://desktop.test',
} as Bindings;
const app = new Hono<AppEnv>();
app.use('*', requestContext, corsAndOrigin, securityHeaders);
app.get('/ok', (context) => context.json({ ok: true }));
app.post('/ok', (context) => context.json({ ok: true }));
app.onError((error, context) =>
  context.json({ code: error instanceof ApiError ? error.code : 'unknown' }, 403),
);

describe('HTTP boundary controls', () => {
  it('normalizes origin allowlists', () => {
    expect([...allowedOrigins(' a, b ,,')]).toEqual(['a', 'b']);
  });

  it('sets hardening and accepted CORS headers', async () => {
    const response = await app.request(
      'https://api.test/ok',
      { headers: { Origin: 'https://app.test' } },
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.test');
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=');
    expect(response.headers.get('Permissions-Policy')).toContain('camera=()');
    expect(response.headers.get('X-Request-ID')).toMatch(/^req_/u);
  });

  it('handles valid preflight and rejects unsafe origins', async () => {
    const preflight = await app.request(
      'https://api.test/ok',
      { method: 'OPTIONS', headers: { Origin: 'https://desktop.test' } },
      env,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('POST');

    const denied = await app.request(
      'https://api.test/ok',
      { method: 'POST', headers: { Origin: 'https://evil.test' } },
      env,
    );
    expect(denied.status).toBe(403);
    const deniedPreflight = await app.request(
      'https://api.test/ok',
      { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } },
      env,
    );
    expect(deniedPreflight.status).toBe(403);
  });

  it('applies private no-store headers', () => {
    const headers = new Headers();
    noStore(headers);
    expect(headers.get('Cache-Control')).toContain('no-store');
    expect(headers.get('Pragma')).toBe('no-cache');
  });
});
