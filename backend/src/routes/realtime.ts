import { APP_CONFIG, Permission } from '@nexa/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { authenticate } from '../lib/auth';
import { ApiError } from '../lib/errors';
import { requireConversationMember, requireServerPermission } from '../lib/permissions';

const realtime = new Hono<AppEnv>();

realtime.get('/realtime/:kind/:roomId', authenticate, async (context) => {
  if (context.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    throw new ApiError('upgrade_required', 'A WebSocket upgrade is required.', 426);
  }
  const kind = context.req.param('kind');
  const roomId = context.req.param('roomId');
  const user = context.get('user');
  if (kind === 'conversation') {
    await requireConversationMember(context.env.DB, user.id, roomId);
  } else if (kind === 'channel' || kind === 'voice') {
    const channel = await context.env.DB.prepare(
      'SELECT server_id, type FROM channels WHERE id = ?',
    )
      .bind(roomId)
      .first<{ server_id: string; type: string }>();
    if (!channel || (kind === 'voice' && channel.type !== 'voice')) {
      throw new ApiError('not_found', 'Realtime room not found.', 404);
    }
    await requireServerPermission(
      context.env.DB,
      user.id,
      channel.server_id,
      kind === 'voice' ? Permission.CONNECT_VOICE : Permission.VIEW_CHANNEL,
      roomId,
    );
  } else {
    throw new ApiError('not_found', 'Realtime room not found.', 404);
  }
  const roomName = `${kind}:${roomId}`;
  const id = context.env.ROOMS.idFromName(roomName);
  const stub = context.env.ROOMS.get(id);
  if (kind === 'voice') {
    const countResponse = await stub.fetch('https://room.internal/count', {
      headers: { Authorization: `Internal ${context.env.INTERNAL_SECRET}` },
    });
    const count = countResponse.ok
      ? (((await countResponse.json()) as { count?: number }).count ?? 0)
      : APP_CONFIG.maxVoicePeers;
    if (count >= APP_CONFIG.maxVoicePeers) {
      throw new ApiError(
        'voice_room_full',
        `Free peer-to-peer voice rooms support up to ${APP_CONFIG.maxVoicePeers} people.`,
        409,
      );
    }
  }
  const headers = new Headers(context.req.raw.headers);
  headers.set('Authorization', `Internal ${context.env.INTERNAL_SECRET}`);
  headers.set('X-Nexa-User', user.id);
  headers.set('X-Nexa-Session', user.sessionId);
  headers.set('X-Nexa-Room-Kind', kind);
  headers.set('X-Nexa-Room-ID', roomId);
  return stub.fetch('https://room.internal/connect', { headers });
});

export default realtime;
