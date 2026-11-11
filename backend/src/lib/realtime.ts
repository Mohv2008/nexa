import type { Bindings } from '../env';

export async function broadcastRoom(
  env: Bindings,
  roomName: string,
  event: unknown,
): Promise<void> {
  const id = env.ROOMS.idFromName(roomName);
  const response = await env.ROOMS.get(id).fetch('https://room.internal/broadcast', {
    method: 'POST',
    headers: {
      Authorization: `Internal ${env.INTERNAL_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error(`Realtime broadcast failed (${response.status})`);
}
