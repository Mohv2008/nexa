import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Bindings } from '../src/env';

const bindings = env as unknown as Bindings;
const userId = 'usr_realtime_test';
const sessionId = 'ses_realtime_test';
const conversationId = 'cnv_realtime_test';

beforeAll(async () => {
  const now = Math.floor(Date.now() / 1000);
  await bindings.DB.batch([
    bindings.DB.prepare(
      `INSERT INTO users (id, email, username, display_name, password_hash, birth_date)
       VALUES (?, 'realtime@example.com', 'realtime_test', 'Realtime', 'hash', '2000-01-01')`,
    ).bind(userId),
    bindings.DB.prepare(
      `INSERT INTO sessions
        (id, user_id, token_hash, csrf_hash, expires_at, last_seen_at, created_at)
       VALUES (?, ?, 'realtime-token-hash', 'csrf', ?, ?, ?)`,
    ).bind(sessionId, userId, now + 3600, now, now),
    bindings.DB.prepare("INSERT INTO conversations (id, type) VALUES (?, 'direct')").bind(
      conversationId,
    ),
    bindings.DB.prepare(
      "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'owner')",
    ).bind(conversationId, userId),
  ]);
});

function nextEvent(socket: WebSocket, type = 'message'): Promise<Event> {
  return new Promise((resolve) => socket.addEventListener(type, resolve, { once: true }));
}

async function connect(): Promise<WebSocket> {
  const id = bindings.ROOMS.idFromName(`conversation:${conversationId}`);
  const response = await bindings.ROOMS.get(id).fetch('https://room.internal/connect', {
    headers: {
      Authorization: `Internal ${bindings.INTERNAL_SECRET}`,
      Upgrade: 'websocket',
      'X-Nexa-User': userId,
      'X-Nexa-Session': sessionId,
      'X-Nexa-Room-Kind': 'conversation',
      'X-Nexa-Room-ID': conversationId,
    },
  });
  expect(response.status).toBe(101);
  expect(response.webSocket).toBeTruthy();
  const socket = response.webSocket!;
  const ready = nextEvent(socket);
  socket.accept();
  const event = (await ready) as MessageEvent;
  expect(JSON.parse(String(event.data))).toMatchObject({
    type: 'ready',
    data: { userId, roomId: conversationId },
  });
  return socket;
}

describe('Durable Object WebSocket protocol', () => {
  it('rejects unauthenticated internal requests', async () => {
    const id = bindings.ROOMS.idFromName('forbidden-room');
    const response = await bindings.ROOMS.get(id).fetch('https://room.internal/count');
    expect(response.status).toBe(403);
  });

  it('authenticates, responds to heartbeat, orders creation, and deduplicates nonce retries', async () => {
    const socket = await connect();
    let next = nextEvent(socket);
    socket.send(JSON.stringify({ type: 'ping', data: {} }));
    expect(JSON.parse(String(((await next) as MessageEvent).data)).type).toBe('pong');

    const message = {
      content: 'Realtime message',
      clientNonce: 'realtime-nonce-0001',
      attachmentKeys: [],
    };
    next = nextEvent(socket);
    socket.send(JSON.stringify({ type: 'message.create', data: message }));
    const created = JSON.parse(String(((await next) as MessageEvent).data)) as {
      type: string;
      data: { id: string; content: string };
    };
    expect(created.type).toBe('message.created');
    expect(created.data.content).toBe('Realtime message');

    next = nextEvent(socket);
    socket.send(JSON.stringify({ type: 'message.create', data: message }));
    const duplicate = JSON.parse(String(((await next) as MessageEvent).data)) as {
      type: string;
      data: { id: string };
    };
    expect(duplicate.type).toBe('message.duplicate');
    expect(duplicate.data.id).toBe(created.data.id);
    socket.close(1000, 'test complete');
  });

  it('closes oversized frames', async () => {
    const socket = await connect();
    const closed = nextEvent(socket, 'close');
    socket.send('x'.repeat(17 * 1024));
    const event = (await closed) as CloseEvent;
    expect(event.code).toBe(1009);
  });
});
