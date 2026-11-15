import type { Bindings } from '../env';
import { S3Client, type S3Credentials } from './s3';

/**
 * Storage-agnostic media backend.
 *
 * NEXA stores user uploads in Backblaze B2 through its S3-compatible API by
 * default (10 GB free, no payment method required). Cloudflare R2 is still
 * supported as an alternative backend and is selected automatically when it
 * is the only configured option.
 */

export interface MediaPutOptions {
  contentType: string;
  contentDisposition?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface MediaObject {
  body: ReadableStream<Uint8Array>;
  etag: string;
  contentType: string | null;
}

export interface MediaStore {
  readonly backend: 'b2' | 'r2';
  put(key: string, bytes: Uint8Array, options: MediaPutOptions): Promise<{ etag: string }>;
  get(key: string): Promise<MediaObject | null>;
  delete(key: string): Promise<void>;
}

class B2MediaStore implements MediaStore {
  readonly backend = 'b2' as const;
  private readonly client: S3Client;

  constructor(credentials: S3Credentials) {
    this.client = new S3Client(credentials);
  }

  put(key: string, bytes: Uint8Array, options: MediaPutOptions): Promise<{ etag: string }> {
    return this.client.put(key, bytes, options);
  }

  get(key: string): Promise<MediaObject | null> {
    return this.client.get(key);
  }

  delete(key: string): Promise<void> {
    return this.client.delete(key);
  }
}

class R2MediaStore implements MediaStore {
  readonly backend = 'r2' as const;

  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, bytes: Uint8Array, options: MediaPutOptions): Promise<{ etag: string }> {
    const httpMetadata: R2HTTPMetadata = { contentType: options.contentType };
    if (options.contentDisposition) httpMetadata.contentDisposition = options.contentDisposition;
    if (options.cacheControl) httpMetadata.cacheControl = options.cacheControl;
    const putOptions: R2PutOptions = { httpMetadata };
    if (options.metadata) putOptions.customMetadata = options.metadata;
    const object = await this.bucket.put(key, bytes, putOptions);
    return { etag: object?.httpEtag ?? '' };
  }

  async get(key: string): Promise<MediaObject | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    return {
      body: object.body,
      etag: object.httpEtag,
      contentType: object.httpMetadata?.contentType ?? null,
    };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}

export interface MediaConfig {
  backend?: string | undefined;
  b2Endpoint?: string | undefined;
  b2Region?: string | undefined;
  b2Bucket?: string | undefined;
  b2AccessKeyId?: string | undefined;
  b2SecretAccessKey?: string | undefined;
  r2?: R2Bucket | undefined;
}

function readB2Credentials(config: MediaConfig): S3Credentials | null {
  const { b2Endpoint, b2Region, b2Bucket, b2AccessKeyId, b2SecretAccessKey } = config;
  if (!b2Endpoint || !b2Region || !b2Bucket || !b2AccessKeyId || !b2SecretAccessKey) return null;
  return {
    endpoint: b2Endpoint,
    region: b2Region,
    bucket: b2Bucket,
    accessKeyId: b2AccessKeyId,
    secretAccessKey: b2SecretAccessKey,
  };
}

/**
 * Resolves the configured media backend.
 *
 * `MEDIA_BACKEND` forces a choice (`b2` or `r2`); otherwise B2 is used when it
 * is fully configured and R2 is used when only the R2 binding is present.
 */
export function createMediaStore(config: MediaConfig): MediaStore {
  const requested = config.backend?.trim().toLowerCase();
  const b2 = readB2Credentials(config);

  if (requested === 'b2') {
    if (!b2) {
      throw new Error(
        'MEDIA_BACKEND=b2 requires B2_ENDPOINT, B2_REGION, B2_BUCKET, B2_ACCESS_KEY_ID and B2_SECRET_ACCESS_KEY.',
      );
    }
    return new B2MediaStore(b2);
  }

  if (requested === 'r2') {
    if (!config.r2) throw new Error('MEDIA_BACKEND=r2 requires an R2 bucket binding named MEDIA.');
    return new R2MediaStore(config.r2);
  }

  if (b2) return new B2MediaStore(b2);
  if (config.r2) return new R2MediaStore(config.r2);

  throw new Error(
    'No media backend configured. Set the B2_* bindings (or attach the R2 MEDIA binding).',
  );
}

export function createMediaStoreFromEnv(env: Bindings): MediaStore {
  return createMediaStore({
    backend: env.MEDIA_BACKEND,
    b2Endpoint: env.B2_ENDPOINT,
    b2Region: env.B2_REGION,
    b2Bucket: env.B2_BUCKET,
    b2AccessKeyId: env.B2_ACCESS_KEY_ID,
    b2SecretAccessKey: env.B2_SECRET_ACCESS_KEY,
    r2: env.MEDIA,
  });
}

/** Reports which backend is active without throwing, for health output. */
export function describeMediaStore(env: Bindings): 'b2' | 'r2' | 'unconfigured' {
  const requested = env.MEDIA_BACKEND?.trim().toLowerCase();
  if (requested === 'b2' || requested === 'r2') return requested;
  if (
    readB2Credentials({
      b2Endpoint: env.B2_ENDPOINT,
      b2Region: env.B2_REGION,
      b2Bucket: env.B2_BUCKET,
      b2AccessKeyId: env.B2_ACCESS_KEY_ID,
      b2SecretAccessKey: env.B2_SECRET_ACCESS_KEY,
    })
  ) {
    return 'b2';
  }
  if (env.MEDIA) return 'r2';
  return 'unconfigured';
}
