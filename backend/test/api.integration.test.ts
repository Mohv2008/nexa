import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://app.test';

interface Session {
  cookie: string;
  csrf: string;
  userId: string;
}

function setCookies(headers: Headers): string[] {
  const values = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (values?.length) return values;
  const combined = headers.get('Set-Cookie');
  return combined ? combined.split(/,(?=\s*[^;,]+=)/u) : [];
}

async function call(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    session?: Session;
    contentType?: string;
  } = {},
): Promise<Response> {
  const headers = new Headers({ Origin: ORIGIN });
  if (options.body !== undefined) {
    headers.set('Content-Type', options.contentType ?? 'application/json');
  }
  if (options.session) {
    headers.set('Cookie', options.session.cookie);
    headers.set('X-CSRF-Token', options.session.csrf);
  }
  const body =
    options.body === undefined
      ? undefined
      : typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body);
  return exports.default.fetch(`https://api.test/v1${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

async function register(suffix: string): Promise<Session> {
  const response = await call('/auth/register', {
    method: 'POST',
    body: {
      email: `person-${suffix}@example.com`,
      username: `person_${suffix}`,
      displayName: `Person ${suffix}`,
      password: 'Correct Horse Battery 7',
      birthDate: '2000-01-01',
      acceptTerms: true,
    },
  });
  expect(response.status).toBe(201);
  const payload = (await response.json()) as {
    data: { user: { id: string }; csrfToken: string };
  };
  const cookie = setCookies(response.headers)
    .map((value) => value.split(';')[0])
    .filter(Boolean)
    .join('; ');
  expect(cookie).toContain('nexa_access=');
  expect(cookie).toContain('nexa_refresh=');
  return { cookie, csrf: payload.data.csrfToken, userId: payload.data.user.id };
}

describe('NEXA API integration', () => {
  it('reports health and applies defensive headers', async () => {
    const response = await exports.default.fetch('https://api.test/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    await expect(response.json()).resolves.toMatchObject({ status: 'ok', database: 'ok' });
  });

  it('rejects unauthenticated, malformed, wrong-origin, and wrong-content-type requests', async () => {
    expect((await call('/servers')).status).toBe(401);
    expect(
      (
        await call('/auth/login', {
          method: 'POST',
          body: '{bad json',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('/auth/login', {
          method: 'POST',
          body: 'identifier=x',
          contentType: 'application/x-www-form-urlencoded',
        })
      ).status,
    ).toBe(415);
    const denied = await exports.default.fetch('https://api.test/v1/auth/login', {
      method: 'POST',
      headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(denied.status).toBe(403);
  });

  it('uses cross-site Secure cookies only for the explicitly allowed Tauri origin', async () => {
    const response = await exports.default.fetch('https://api.test/v1/auth/register', {
      method: 'POST',
      headers: { Origin: 'tauri://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'tauri-cookie@example.com',
        username: 'tauri_cookie',
        displayName: 'Tauri Cookie',
        password: 'Correct Horse Battery 7',
        birthDate: '2000-01-01',
        acceptTerms: true,
      }),
    });
    expect(response.status).toBe(201);
    const cookies = setCookies(response.headers);
    expect(cookies).toHaveLength(3);
    expect(cookies.every((cookie) => /SameSite=None/iu.test(cookie))).toBe(true);
    expect(cookies.every((cookie) => /Secure/iu.test(cookie))).toBe(true);
    const payload = (await response.json()) as { data: { csrfToken: string } };
    const cookieHeader = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
    const logout = await exports.default.fetch('https://api.test/v1/auth/logout', {
      method: 'POST',
      headers: {
        Origin: 'tauri://localhost',
        Cookie: cookieHeader,
        'X-CSRF-Token': payload.data.csrfToken,
      },
    });
    expect(logout.status).toBe(204);
  });

  it('runs an account, community, role-boundary, social, and chat lifecycle', async () => {
    const owner = await register('owner');
    const member = await register('member');

    const me = await call('/auth/me', { session: owner });
    expect(me.status).toBe(200);

    const createdServer = await call('/servers', {
      method: 'POST',
      session: owner,
      body: { name: 'NEXA Testers', description: 'Integration test', visibility: 'public' },
    });
    expect(createdServer.status).toBe(201);
    const serverPayload = (await createdServer.json()) as {
      data: { id: string; defaultChannelId: string };
    };
    const { id: serverId, defaultChannelId: channelId } = serverPayload.data;

    expect(
      (
        await call(`/servers/${serverId}/join`, {
          method: 'POST',
          session: member,
          body: {},
        })
      ).status,
    ).toBe(200);

    const forbiddenChannel = await call(`/servers/${serverId}/channels`, {
      method: 'POST',
      session: member,
      body: { name: 'unauthorized', type: 'text' },
    });
    expect(forbiddenChannel.status).toBe(403);

    const postResponse = await call('/posts', {
      method: 'POST',
      session: owner,
      body: { body: 'Hello from integration tests', visibility: 'public', mediaKeys: [] },
    });
    expect(postResponse.status).toBe(201);
    const post = (await postResponse.json()) as { data: { id: string } };
    expect(
      (
        await call(`/posts/${post.data.id}/likes`, {
          method: 'POST',
          session: member,
          body: {},
        })
      ).status,
    ).toBe(200);
    expect((await call('/feed', { session: member })).status).toBe(200);

    const messageResponse = await call(`/channels/${channelId}/messages`, {
      method: 'POST',
      session: member,
      body: {
        content: 'A real channel message',
        clientNonce: crypto.randomUUID(),
        attachmentKeys: [],
      },
    });
    expect(messageResponse.status).toBe(201);
    const messages = await call(`/channels/${channelId}/messages`, { session: owner });
    expect(messages.status).toBe(200);
    const messagePage = (await messages.json()) as { data: { items: unknown[] } };
    expect(messagePage.data.items).toHaveLength(1);

    expect(
      (
        await call('/reports', {
          method: 'POST',
          session: member,
          body: { targetType: 'post', targetId: post.data.id, reason: 'spam', details: 'test' },
        })
      ).status,
    ).toBe(201);
  }, 30_000);
});
