import { Permission, type MessageInput } from '@nexa/shared';
import { DurableObject } from 'cloudflare:workers';
import type { Bindings } from '../env';
import { createMessage, type MessageTarget } from '../lib/message-service';
import { createNotification, notifyMentionedUsers } from '../lib/notifications';
import { requireConversationMember, requireServerPermission } from '../lib/permissions';

interface SocketAttachment {
  userId: string;
  sessionId: string;
  roomKind: 'channel' | 'conversation' | 'voice';
  roomId: string;
  windowStartedAt: number;
  eventCount: number;
}

interface IncomingEvent {
  type: string;
  data?: unknown;
}

interface SignalData {
  targetUserId: string;
  signal: unknown;
}

export class RealtimeRoom extends DurableObject<Bindings> {
  constructor(
    state: DurableObjectState,
    private readonly bindings: Bindings,
  ) {
    super(state, bindings);
  }

  private authorized(request: Request): boolean {
    return request.headers.get('Authorization') === `Internal ${this.bindings.INTERNAL_SECRET}`;
  }

  override async fetch(request: Request): Promise<Response> {
    if (!this.authorized(request)) return new Response('Forbidden', { status: 403 });
    const path = new URL(request.url).pathname;
    if (path === '/broadcast' && request.method === 'POST') {
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > 64 * 1024) {
        return new Response('Payload too large', { status: 413 });
      }
      this.broadcast(text);
      return new Response(null, { status: 204 });
    }
    if (path === '/count') {
      const users = new Set(
        this.ctx
          .getWebSockets()
          .map((socket) => (socket.deserializeAttachment() as SocketAttachment | null)?.userId),
      );
      users.delete(undefined);
      return Response.json({ count: users.size });
    }
    if (path !== '/connect' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Not found', { status: 404 });
    }
    const userId = request.headers.get('X-Nexa-User');
    const sessionId = request.headers.get('X-Nexa-Session');
    const roomKind = request.headers.get('X-Nexa-Room-Kind');
    const roomId = request.headers.get('X-Nexa-Room-ID');
    if (
      !userId ||
      !sessionId ||
      !roomId ||
      (roomKind !== 'channel' && roomKind !== 'conversation' && roomKind !== 'voice')
    ) {
      return new Response('Invalid connection metadata', { status: 400 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: SocketAttachment = {
      userId,
      sessionId,
      roomKind,
      roomId,
      windowStartedAt: Date.now(),
      eventCount: 0,
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [userId]);
    const participants = [
      ...new Set(
        this.ctx
          .getWebSockets()
          .map((socket) => (socket.deserializeAttachment() as SocketAttachment | null)?.userId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    this.send(server, {
      type: 'ready',
      data: { roomId, userId, participants },
    });
    this.broadcast(
      JSON.stringify({ type: 'presence', data: { userId, status: 'online' } }),
      server,
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  private send(socket: WebSocket, event: unknown): void {
    if (socket.readyState !== 1) return;
    if (socket.bufferedAmount > 512 * 1024) {
      socket.close(1013, 'Backpressure');
      return;
    }
    try {
      socket.send(typeof event === 'string' ? event : JSON.stringify(event));
    } catch {
      socket.close(1011, 'Send failed');
    }
  }

  private broadcast(event: string, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== except) this.send(socket, event);
    }
  }

  private error(socket: WebSocket, code: string, message: string): void {
    this.send(socket, { type: 'error', data: { code, message } });
  }

  private async ensureSession(attachment: SocketAttachment): Promise<boolean> {
    const session = await this.bindings.DB.prepare(
      'SELECT 1 AS valid FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?',
    )
      .bind(attachment.sessionId, attachment.userId, Math.floor(Date.now() / 1000))
      .first();
    return Boolean(session);
  }

  private async ensureRoomAccess(attachment: SocketAttachment): Promise<void> {
    if (attachment.roomKind === 'conversation') {
      await requireConversationMember(this.bindings.DB, attachment.userId, attachment.roomId);
      return;
    }
    const channel = await this.bindings.DB.prepare(
      'SELECT server_id, type FROM channels WHERE id = ?',
    )
      .bind(attachment.roomId)
      .first<{ server_id: string; type: string }>();
    if (!channel) throw new Error('Channel not found');
    await requireServerPermission(
      this.bindings.DB,
      attachment.userId,
      channel.server_id,
      attachment.roomKind === 'voice' ? Permission.CONNECT_VOICE : Permission.VIEW_CHANNEL,
      attachment.roomId,
    );
  }

  override async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : new Uint8Array(raw);
    if (bytes.byteLength > 16 * 1024) {
      socket.close(1009, 'Message too large');
      return;
    }
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) {
      socket.close(1008, 'Missing session');
      return;
    }
    const now = Date.now();
    if (now - attachment.windowStartedAt >= 10_000) {
      attachment.windowStartedAt = now;
      attachment.eventCount = 0;
    }
    attachment.eventCount += 1;
    socket.serializeAttachment(attachment);
    if (attachment.eventCount > 60) {
      this.error(socket, 'rate_limited', 'Too many realtime events.');
      if (attachment.eventCount > 90) socket.close(1008, 'Rate limit exceeded');
      return;
    }
    if (!(await this.ensureSession(attachment))) {
      socket.close(4001, 'Session expired');
      return;
    }
    let event: IncomingEvent;
    try {
      const parsed: unknown = JSON.parse(
        typeof raw === 'string' ? raw : new TextDecoder().decode(raw),
      );
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof (parsed as { type?: unknown }).type !== 'string'
      ) {
        throw new TypeError('Invalid event');
      }
      event = parsed as IncomingEvent;
    } catch {
      this.error(socket, 'invalid_event', 'Event JSON is invalid.');
      return;
    }
    if (event.type === 'ping') {
      this.send(socket, { type: 'pong', data: { now } });
      return;
    }
    try {
      await this.ensureRoomAccess(attachment);
      if (event.type === 'typing') {
        const active =
          Boolean(event.data) &&
          typeof event.data === 'object' &&
          (event.data as { active?: unknown }).active === true;
        this.broadcast(
          JSON.stringify({ type: 'typing', data: { userId: attachment.userId, active } }),
          socket,
        );
        return;
      }
      if (event.type === 'presence') {
        const status =
          event.data && typeof event.data === 'object'
            ? (event.data as { status?: unknown }).status
            : null;
        if (!['online', 'idle', 'dnd'].includes(String(status))) {
          this.error(socket, 'invalid_presence', 'Presence is invalid.');
          return;
        }
        this.broadcast(
          JSON.stringify({
            type: 'presence',
            data: { userId: attachment.userId, status },
          }),
          socket,
        );
        return;
      }
      if (event.type === 'signal') {
        if (attachment.roomKind !== 'voice') {
          this.error(socket, 'invalid_room', 'Signaling is limited to voice rooms.');
          return;
        }
        const signal = event.data as Partial<SignalData> | undefined;
        if (
          !signal ||
          typeof signal.targetUserId !== 'string' ||
          signal.targetUserId === attachment.userId
        ) {
          this.error(socket, 'invalid_signal', 'Signal target is invalid.');
          return;
        }
        const serialized = JSON.stringify({
          type: 'signal',
          data: { userId: attachment.userId, signal: signal.signal },
        });
        for (const target of this.ctx.getWebSockets(signal.targetUserId))
          this.send(target, serialized);
        return;
      }
      if (event.type === 'read') {
        const messageId =
          event.data && typeof event.data === 'object'
            ? (event.data as { messageId?: unknown }).messageId
            : null;
        if (typeof messageId !== 'string') {
          this.error(socket, 'invalid_read', 'Read marker is invalid.');
          return;
        }
        if (attachment.roomKind === 'conversation') {
          const update = await this.bindings.DB.prepare(
            `UPDATE conversation_members SET last_read_message_id = ?
              WHERE conversation_id = ? AND user_id = ?
                AND EXISTS (SELECT 1 FROM messages WHERE id = ? AND conversation_id = ?)`,
          )
            .bind(messageId, attachment.roomId, attachment.userId, messageId, attachment.roomId)
            .run();
          if (update.meta.changes === 0) throw new Error('Message not found');
        } else if (attachment.roomKind === 'channel') {
          await this.bindings.DB.prepare(
            `INSERT INTO channel_reads (channel_id, user_id, last_read_message_id)
             SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM messages WHERE id = ? AND channel_id = ?)
             ON CONFLICT(channel_id, user_id) DO UPDATE SET
               last_read_message_id = excluded.last_read_message_id,
               read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
          )
            .bind(attachment.roomId, attachment.userId, messageId, messageId, attachment.roomId)
            .run();
        }
        this.broadcast(
          JSON.stringify({
            type: 'read',
            data: { userId: attachment.userId, messageId },
          }),
          socket,
        );
        return;
      }
      if (event.type === 'message.create') {
        if (attachment.roomKind === 'voice') {
          this.error(socket, 'invalid_room', 'Voice rooms do not contain messages.');
          return;
        }
        const target: MessageTarget = { kind: attachment.roomKind, id: attachment.roomId };
        const created = await createMessage(
          this.bindings.DB,
          attachment.userId,
          target,
          event.data as MessageInput,
        );
        const message = await this.bindings.DB.prepare(
          `SELECT m.id, m.content, m.client_nonce, m.reply_to_id, m.thread_id, m.created_at,
                  u.id AS author_id, u.username, u.display_name, u.avatar_key, u.status
             FROM messages m JOIN users u ON u.id = m.author_id WHERE m.id = ?`,
        )
          .bind(created.id)
          .first();
        if (!created.duplicate) {
          this.broadcast(JSON.stringify({ type: 'message.created', data: message }));
          const content = (event.data as { content?: unknown } | undefined)?.content;
          if (typeof content === 'string') {
            await notifyMentionedUsers(
              this.bindings.DB,
              content,
              attachment.userId,
              'message_mention',
              created.id,
            );
          }
          if (attachment.roomKind === 'conversation') {
            const members = await this.bindings.DB.prepare(
              `SELECT user_id FROM conversation_members
                WHERE conversation_id = ? AND user_id <> ? AND left_at IS NULL`,
            )
              .bind(attachment.roomId, attachment.userId)
              .all<{ user_id: string }>();
            await Promise.all(
              members.results.map((member) =>
                createNotification(
                  this.bindings.DB,
                  member.user_id,
                  attachment.userId,
                  'direct_message',
                  created.id,
                  { conversationId: attachment.roomId },
                ),
              ),
            );
          }
        } else {
          this.send(socket, { type: 'message.duplicate', data: message });
        }
        return;
      }
      this.error(socket, 'unknown_event', 'Event type is not supported.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Realtime operation failed.';
      this.error(socket, 'operation_failed', message.slice(0, 200));
    }
  }

  override webSocketClose(
    socket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): void {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;
    const stillConnected = this.ctx
      .getWebSockets(attachment.userId)
      .some((candidate) => candidate !== socket && candidate.readyState === 1);
    if (!stillConnected) {
      this.broadcast(
        JSON.stringify({
          type: 'presence',
          data: { userId: attachment.userId, status: 'offline' },
        }),
        socket,
      );
    }
  }

  override webSocketError(socket: WebSocket): void {
    socket.close(1011, 'WebSocket error');
  }
}
