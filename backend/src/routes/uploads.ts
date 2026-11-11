import { APP_CONFIG, newId, safeFilename } from '@nexa/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { authenticate, requireCsrf, resolveAuthentication } from '../lib/auth';
import { ApiError } from '../lib/errors';
import { inspectAndSanitize } from '../lib/media';
import { enforceRateLimit } from '../lib/rate-limit';

const uploads = new Hono<AppEnv>();

interface UploadRow {
  id: string;
  owner_id: string;
  object_key: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
}

uploads.post('/uploads', authenticate, requireCsrf, async (context) => {
  const user = context.get('user');
  await enforceRateLimit(context, 'upload', user.id, 60, 60 * 60);
  const declaredLength = Number(context.req.header('Content-Length') ?? 0);
  if (declaredLength > APP_CONFIG.maxUploadBytes + 64 * 1024) {
    throw new ApiError('payload_too_large', 'Upload is too large.', 413);
  }
  const contentType = context.req.header('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    throw new ApiError('unsupported_media_type', 'Use multipart/form-data.', 415);
  }
  const form = await context.req.formData();
  const part = form.get('file');
  if (!(part instanceof File)) throw new ApiError('file_required', 'A file is required.', 400);
  if (part.size <= 0 || part.size > APP_CONFIG.maxUploadBytes) {
    throw new ApiError('payload_too_large', 'File size is not allowed.', 413);
  }
  const inspected = inspectAndSanitize(new Uint8Array(await part.arrayBuffer()), part.type);
  if (!inspected) {
    throw new ApiError('unsafe_file', 'File type or contents are not allowed.', 415);
  }
  const limit =
    inspected.kind === 'image'
      ? APP_CONFIG.maxImageBytes
      : inspected.kind === 'audio'
        ? APP_CONFIG.maxVoiceBytes
        : APP_CONFIG.maxUploadBytes;
  if (inspected.bytes.byteLength > limit) {
    throw new ApiError('payload_too_large', 'File exceeds the limit for this media type.', 413);
  }
  const uploadId = newId('upl');
  const date = new Date().toISOString().slice(0, 10);
  const objectKey = `${user.id}/${date}/${crypto.randomUUID()}.${inspected.extension}`;
  const originalName = safeFilename(part.name) || `upload.${inspected.extension}`;
  await context.env.MEDIA.put(objectKey, inspected.bytes, {
    httpMetadata: {
      contentType: inspected.mime,
      contentDisposition: `attachment; filename="${originalName.replace(/["\\]/g, '_')}"`,
      cacheControl: 'private, max-age=31536000, immutable',
    },
    customMetadata: { owner: user.id, uploadId },
  });
  try {
    await context.env.DB.prepare(
      `INSERT INTO uploads (id, owner_id, object_key, original_name, mime_type, byte_size)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(uploadId, user.id, objectKey, originalName, inspected.mime, inspected.bytes.byteLength)
      .run();
  } catch (error) {
    await context.env.MEDIA.delete(objectKey);
    throw error;
  }
  return context.json(
    {
      data: {
        id: uploadId,
        key: objectKey,
        name: originalName,
        mime: inspected.mime,
        size: inspected.bytes.byteLength,
        url: `/v1/media/${encodeURIComponent(objectKey)}`,
      },
    },
    201,
  );
});

uploads.get('/media/*', async (context) => {
  const marker = '/media/';
  const position = context.req.path.indexOf(marker);
  const encodedKey = position >= 0 ? context.req.path.slice(position + marker.length) : '';
  let key: string;
  try {
    key = decodeURIComponent(encodedKey);
  } catch {
    throw new ApiError('not_found', 'Media not found.', 404);
  }
  if (!key || key.includes('..') || key.startsWith('/')) {
    throw new ApiError('not_found', 'Media not found.', 404);
  }
  const upload = await context.env.DB.prepare(
    `SELECT id, owner_id, object_key, original_name, mime_type, byte_size
       FROM uploads WHERE object_key = ?`,
  )
    .bind(key)
    .first<UploadRow>();
  if (!upload) throw new ApiError('not_found', 'Media not found.', 404);
  const isPublic = await context.env.DB.prepare(
    `SELECT 1 AS allowed
       WHERE EXISTS (SELECT 1 FROM users WHERE avatar_key = ?)
          OR EXISTS (
            SELECT 1 FROM post_media pm JOIN posts p ON p.id = pm.post_id
             WHERE pm.upload_id = ? AND p.visibility = 'public' AND p.deleted_at IS NULL
          )`,
  )
    .bind(key, upload.id)
    .first();
  if (!isPublic) {
    const user = await resolveAuthentication(context);
    if (!user) throw new ApiError('not_found', 'Media not found.', 404);
    if (user.id !== upload.owner_id) {
      const permitted = await context.env.DB.prepare(
        `SELECT 1 AS allowed
           FROM message_attachments ma
           JOIN messages m ON m.id = ma.message_id
           LEFT JOIN conversation_members cm
             ON cm.conversation_id = m.conversation_id AND cm.user_id = ? AND cm.left_at IS NULL
           LEFT JOIN channels c ON c.id = m.channel_id
           LEFT JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = ?
          WHERE ma.upload_id = ? AND (cm.user_id IS NOT NULL OR sm.user_id IS NOT NULL)
          LIMIT 1`,
      )
        .bind(user.id, user.id, upload.id)
        .first();
      if (!permitted) throw new ApiError('not_found', 'Media not found.', 404);
    }
  }
  const object = await context.env.MEDIA.get(upload.object_key);
  if (!object) throw new ApiError('not_found', 'Media not found.', 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Content-Type', upload.mime_type);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  headers.set('Cross-Origin-Resource-Policy', 'same-site');
  if (upload.mime_type.startsWith('image/') || upload.mime_type.startsWith('audio/')) {
    headers.set(
      'Content-Disposition',
      `inline; filename="${upload.original_name.replace(/["\\]/g, '_')}"`,
    );
  } else {
    headers.set(
      'Content-Disposition',
      `attachment; filename="${upload.original_name.replace(/["\\]/g, '_')}"`,
    );
  }
  headers.set(
    'Cache-Control',
    isPublic ? 'public, max-age=31536000, immutable' : 'private, no-store',
  );
  return new Response(object.body, { headers });
});

export default uploads;
