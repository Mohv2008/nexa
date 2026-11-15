import { describe, expect, it, vi } from 'vitest';
import {
  buildObjectPath,
  encodePathSegment,
  S3Client,
  signRequest,
  type S3Credentials,
} from './s3';

// Placeholder credentials only. They are never sent anywhere: the tests below
// either stub `fetch` or assert on the signature, and the canonical AWS vector
// uses the published example key that upstream already allowlists.
const credentials: S3Credentials = {
  endpoint: 'https://s3.us-west-004.backblazeb2.com',
  region: 'us-west-004',
  bucket: 'nexa-media',
  accessKeyId: '0058a1b2c3d4e5f6',
  secretAccessKey: 'not-a-real-secret-0123456789abcdef',
};

describe('encodePathSegment', () => {
  it('keeps unreserved characters untouched', () => {
    expect(encodePathSegment('abcXYZ019-._~')).toBe('abcXYZ019-._~');
  });

  it('percent encodes reserved and non-ascii characters', () => {
    expect(encodePathSegment('a b')).toBe('a%20b');
    expect(encodePathSegment('a/b')).toBe('a%2Fb');
    expect(encodePathSegment('naïve')).toBe('na%C3%AFve');
    expect(encodePathSegment('a+b')).toBe('a%2Bb');
  });
});

describe('buildObjectPath', () => {
  it('builds a path style url and preserves key separators', () => {
    expect(buildObjectPath('nexa-media', 'usr_1/2026-11-15/abc.png')).toBe(
      '/nexa-media/usr_1/2026-11-15/abc.png',
    );
  });

  it('encodes each segment independently', () => {
    expect(buildObjectPath('nexa-media', 'usr 1/2026/a+b.png')).toBe(
      '/nexa-media/usr%201/2026/a%2Bb.png',
    );
  });
});

describe('signRequest', () => {
  it('matches the canonical AWS SigV4 GET object example', async () => {
    const headers = await signRequest(
      {
        endpoint: 'https://examplebucket.s3.amazonaws.com',
        region: 'us-east-1',
        bucket: 'examplebucket',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
      {
        method: 'GET',
        path: '/test.txt',
        headers: { range: 'bytes=0-9' },
        payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        now: new Date('2013-05-24T00:00:00.000Z'),
      },
    );

    expect(headers.get('Authorization')).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(headers.get('x-amz-date')).toBe('20130524T000000Z');
  });

  it('signs a deterministic signature for repeated requests', async () => {
    const input = {
      method: 'PUT',
      path: '/nexa-media/key.png',
      headers: { 'content-type': 'image/png' },
      payloadHash: 'abc',
      now: new Date('2026-01-02T03:04:05.000Z'),
    };
    const first = await signRequest(credentials, input);
    const second = await signRequest(credentials, input);
    expect(first.get('Authorization')).toBe(second.get('Authorization'));
    expect(first.get('Authorization')).toContain('/20260102/us-west-004/s3/aws4_request');
  });
});

describe('S3Client', () => {
  it('uploads an object with signed headers and returns the etag', async () => {
    const fetchMock = vi.fn(
      async () => new Response('', { status: 200, headers: { etag: '"abc123"' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new S3Client(credentials);
    const result = await client.put('usr_1/2026/a.png', new Uint8Array([1, 2, 3]), {
      contentType: 'image/png',
      contentDisposition: 'attachment; filename="a.png"',
      cacheControl: 'private, max-age=31536000, immutable',
      metadata: { owner: 'usr_1' },
    });

    expect(result.etag).toBe('"abc123"');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://s3.us-west-004.backblazeb2.com/nexa-media/usr_1/2026/a.png');
    expect(init.method).toBe('PUT');
    const headers = init.headers as Headers;
    expect(headers.get('content-type')).toBe('image/png');
    expect(headers.get('content-disposition')).toBe('attachment; filename="a.png"');
    expect(headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(headers.get('x-amz-meta-owner')).toBe('usr_1');
    expect(headers.get('authorization')).toContain('AWS4-HMAC-SHA256');
  });

  it('reads an object and exposes its body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('hello', { headers: { etag: '"e1"', 'content-type': 'text/plain' } }),
      ),
    );

    const client = new S3Client(credentials);
    const object = await client.get('usr_1/2026/a.txt');
    expect(object).not.toBeNull();
    expect(object!.etag).toBe('"e1"');
    expect(object!.contentType).toBe('text/plain');
    await expect(new Response(object!.body).text()).resolves.toBe('hello');
  });

  it('returns null for a missing object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    );
    const client = new S3Client(credentials);
    await expect(client.get('missing')).resolves.toBeNull();
  });

  it('deletes an object and tolerates a missing one', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new S3Client(credentials);
    await expect(client.delete('missing')).resolves.toBeUndefined();
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('DELETE');
  });

  it('surfaces backend errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'AccessDenied', message: 'nope' }), { status: 403 }),
      ),
    );
    const client = new S3Client(credentials);
    await expect(client.get('usr_1/2026/a.png')).rejects.toThrow(/S3 get failed \(403\): nope/);
  });

  it('surfaces delete failures and tolerates a plain text error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('upstream exploded', { status: 500, statusText: 'Server Error' }),
      ),
    );
    const client = new S3Client(credentials);
    await expect(client.delete('usr_1/2026/a.png')).rejects.toThrow(
      /S3 delete failed \(500\): upstream exploded/,
    );
  });

  it('falls back to the error code when the body carries no message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: 'NoSuchBucket' }), { status: 404 })),
    );
    const client = new S3Client(credentials);
    await expect(
      client.put('usr_1/2026/a.png', new Uint8Array([1]), { contentType: 'image/png' }),
    ).rejects.toThrow(/S3 put failed \(404\): NoSuchBucket/);
  });
});
