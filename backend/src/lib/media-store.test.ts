import { describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../env';
import { createMediaStore, createMediaStoreFromEnv, describeMediaStore } from './media-store';

const b2 = {
  b2Endpoint: 'https://s3.us-west-004.backblazeb2.com',
  b2Region: 'us-west-004',
  b2Bucket: 'nexa-media',
  b2AccessKeyId: 'key-id',
  b2SecretAccessKey: 'key-secret',
};

function fakeBucket() {
  const put = vi.fn(async () => ({ httpEtag: '"r2-etag"' }));
  const get = vi.fn(async () => ({
    body: new ReadableStream(),
    httpEtag: '"r2-etag"',
    httpMetadata: { contentType: 'image/png' },
  }));
  const remove = vi.fn(async () => undefined);
  const bucket = { put, get, delete: remove } as unknown as R2Bucket;
  return { bucket, mocks: { put, get, remove } };
}

describe('createMediaStore', () => {
  it('prefers B2 when it is fully configured', () => {
    expect(createMediaStore({ ...b2 }).backend).toBe('b2');
  });

  it('falls back to R2 when only the R2 binding is present', () => {
    expect(createMediaStore({ r2: fakeBucket().bucket }).backend).toBe('r2');
  });

  it('honours an explicit backend selection', () => {
    expect(createMediaStore({ backend: 'b2', ...b2 }).backend).toBe('b2');
    expect(createMediaStore({ backend: 'r2', r2: fakeBucket().bucket }).backend).toBe('r2');
  });

  it('fails loudly when the selected backend is not usable', () => {
    expect(() => createMediaStore({ backend: 'b2' })).toThrow(/requires B2_ENDPOINT/);
    expect(() => createMediaStore({ backend: 'r2' })).toThrow(/requires an R2 bucket binding/);
    expect(() => createMediaStore({})).toThrow(/No media backend configured/);
  });
});

describe('R2 media store', () => {
  it('stores and reads objects through the bucket binding', async () => {
    const { bucket, mocks } = fakeBucket();
    const store = createMediaStore({ r2: bucket });

    const result = await store.put('usr_1/a.png', new Uint8Array([1]), {
      contentType: 'image/png',
      contentDisposition: 'attachment; filename="a.png"',
      cacheControl: 'private',
      metadata: { owner: 'usr_1' },
    });
    expect(result.etag).toBe('"r2-etag"');

    const object = await store.get('usr_1/a.png');
    expect(object?.etag).toBe('"r2-etag"');
    expect(object?.contentType).toBe('image/png');

    await store.delete('usr_1/a.png');
    expect(mocks.remove).toHaveBeenCalledWith('usr_1/a.png');
  });
});

describe('B2 media store', () => {
  it('stores, reads and deletes objects through the S3 API', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('missing')) return new Response('', { status: 404 });
      return new Response('bytes', { headers: { etag: '"b2-etag"', 'content-type': 'image/png' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = createMediaStore({ ...b2 });
    expect(store.backend).toBe('b2');

    const result = await store.put('usr_1/2026/a.png', new Uint8Array([1, 2]), {
      contentType: 'image/png',
      contentDisposition: 'attachment; filename="a.png"',
      cacheControl: 'private',
      metadata: { owner: 'usr_1' },
    });
    expect(result.etag).toBe('"b2-etag"');

    const object = await store.get('usr_1/2026/a.png');
    expect(object?.etag).toBe('"b2-etag"');
    expect(object?.contentType).toBe('image/png');

    await store.delete('usr_1/2026/a.png');
    await expect(store.get('missing')).resolves.toBeNull();

    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urls[0]).toBe('https://s3.us-west-004.backblazeb2.com/nexa-media/usr_1/2026/a.png');
  });
});

describe('describeMediaStore', () => {
  it('reports the active backend without throwing', () => {
    const b2Env = {
      B2_ENDPOINT: b2.b2Endpoint,
      B2_REGION: b2.b2Region,
      B2_BUCKET: b2.b2Bucket,
      B2_ACCESS_KEY_ID: b2.b2AccessKeyId,
      B2_SECRET_ACCESS_KEY: b2.b2SecretAccessKey,
    } as unknown as Bindings;
    expect(describeMediaStore(b2Env)).toBe('b2');
    expect(describeMediaStore({ MEDIA: fakeBucket().bucket } as unknown as Bindings)).toBe('r2');
    expect(describeMediaStore({ MEDIA_BACKEND: 'b2' } as unknown as Bindings)).toBe('b2');
    expect(describeMediaStore({} as unknown as Bindings)).toBe('unconfigured');
  });
});

describe('createMediaStoreFromEnv', () => {
  it('maps worker bindings onto the media configuration', () => {
    const env = {
      MEDIA_BACKEND: 'b2',
      B2_ENDPOINT: b2.b2Endpoint,
      B2_REGION: b2.b2Region,
      B2_BUCKET: b2.b2Bucket,
      B2_ACCESS_KEY_ID: b2.b2AccessKeyId,
      B2_SECRET_ACCESS_KEY: b2.b2SecretAccessKey,
    } as unknown as Bindings;
    expect(createMediaStoreFromEnv(env).backend).toBe('b2');
  });
});
