/**
 * Minimal AWS Signature Version 4 client for S3-compatible object storage.
 *
 * Used for Backblaze B2, whose S3 API accepts SigV4 with a normal application
 * key pair (no session tokens, no 24 hour authorisation dance). Implemented
 * with WebCrypto only so the worker keeps its dependency surface at zero.
 */

const encoder = new TextEncoder();
const UNRESERVED = /[A-Za-z0-9\-._~]/;

export interface S3Credentials {
  /** Origin without a trailing slash, e.g. `https://s3.us-west-004.backblazeb2.com`. */
  endpoint: string;
  /** B2 region identifier, e.g. `us-west-004`. */
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface S3PutOptions {
  contentType: string;
  contentDisposition?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface S3StoredObject {
  body: ReadableStream<Uint8Array>;
  etag: string;
  contentType: string | null;
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return toHex(digest);
}

async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(message) as BufferSource,
  );
  return new Uint8Array(signature);
}

/** RFC 3986 percent-encoding of a single path segment (slashes are preserved by the caller). */
export function encodePathSegment(segment: string): string {
  let out = '';
  for (const byte of encoder.encode(segment)) {
    const char = String.fromCharCode(byte);
    if (byte < 0x80 && UNRESERVED.test(char)) {
      out += char;
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

/** Canonical (and wire) path for a key inside a bucket, keeping `/` separators intact. */
export function buildObjectPath(bucket: string, key: string): string {
  const encodedKey = key
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodePathSegment)
    .join('/');
  return `/${encodePathSegment(bucket)}/${encodedKey}`;
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export interface SignRequestInput {
  method: string;
  /** Canonical path, already percent-encoded. */
  path: string;
  headers: Record<string, string>;
  payloadHash: string;
  now?: Date;
}

/**
 * Signs a request and returns the headers to send, including `Authorization`.
 * The `host` header is derived from the endpoint and is always signed.
 */
export async function signRequest(
  credentials: S3Credentials,
  input: SignRequestInput,
): Promise<Headers> {
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const host = new URL(credentials.endpoint).host;

  const headersToSign: Record<string, string> = {
    host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': amzDate,
  };
  for (const [name, value] of Object.entries(input.headers)) {
    if (value === undefined || value === null) continue;
    headersToSign[name.toLowerCase()] = normalizeHeaderValue(value);
  }

  const names = Object.keys(headersToSign).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headersToSign[name]}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path,
    '',
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${credentials.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(encoder.encode(canonicalRequest)),
  ].join('\n');

  let key = await hmacSha256(encoder.encode(`AWS4${credentials.secretAccessKey}`), dateStamp);
  key = await hmacSha256(key, credentials.region);
  key = await hmacSha256(key, 's3');
  key = await hmacSha256(key, 'aws4_request');
  const signature = toHex((await hmacSha256(key, stringToSign)).buffer as ArrayBuffer);

  const headers = new Headers();
  for (const [name, value] of Object.entries(input.headers)) {
    if (value === undefined || value === null) continue;
    headers.set(name, value);
  }
  headers.set('x-amz-content-sha256', input.payloadHash);
  headers.set('x-amz-date', amzDate);
  headers.set(
    'Authorization',
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );
  return headers;
}

let emptyPayloadHash: Promise<string> | null = null;

function getEmptyPayloadHash(): Promise<string> {
  emptyPayloadHash ??= sha256Hex(new Uint8Array(0));
  return emptyPayloadHash;
}

export class S3Client {
  constructor(private readonly credentials: S3Credentials) {}

  private url(path: string): string {
    return `${this.credentials.endpoint.replace(/\/+$/, '')}${path}`;
  }

  private async send(
    method: string,
    path: string,
    options: { headers?: Record<string, string>; body?: Uint8Array } = {},
  ): Promise<Response> {
    const payloadHash =
      options.body === undefined ? await getEmptyPayloadHash() : await sha256Hex(options.body);
    const headers = await signRequest(this.credentials, {
      method,
      path,
      headers: options.headers ?? {},
      payloadHash,
    });
    const init: RequestInit = { method, headers };
    if (options.body !== undefined) init.body = options.body as BodyInit;
    return fetch(this.url(path), init);
  }

  async put(key: string, bytes: Uint8Array, options: S3PutOptions): Promise<{ etag: string }> {
    const path = buildObjectPath(this.credentials.bucket, key);
    const headers: Record<string, string> = { 'content-type': options.contentType };
    if (options.contentDisposition) headers['content-disposition'] = options.contentDisposition;
    if (options.cacheControl) headers['cache-control'] = options.cacheControl;
    for (const [name, value] of Object.entries(options.metadata ?? {})) {
      headers[`x-amz-meta-${name}`] = value;
    }
    const response = await this.send('PUT', path, { headers, body: bytes });
    if (!response.ok) {
      throw new Error(`S3 put failed (${response.status}): ${await readError(response)}`);
    }
    return { etag: response.headers.get('etag') ?? '' };
  }

  async get(key: string): Promise<S3StoredObject | null> {
    const path = buildObjectPath(this.credentials.bucket, key);
    const response = await this.send('GET', path);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`S3 get failed (${response.status}): ${await readError(response)}`);
    }
    if (!response.body) return null;
    return {
      body: response.body,
      etag: response.headers.get('etag') ?? '',
      contentType: response.headers.get('content-type'),
    };
  }

  async delete(key: string): Promise<void> {
    const path = buildObjectPath(this.credentials.bucket, key);
    const response = await this.send('DELETE', path);
    if (response.ok || response.status === 404) return;
    throw new Error(`S3 delete failed (${response.status}): ${await readError(response)}`);
  }
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return response.statusText;
  try {
    const parsed = JSON.parse(text) as { code?: string; message?: string };
    return parsed.message ?? parsed.code ?? text;
  } catch {
    return text.slice(0, 200);
  }
}
