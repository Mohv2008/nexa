import type { UserSummary } from '@nexa/shared';

export interface Bindings {
  DB: D1Database;
  /** Optional Cloudflare R2 bucket, used when the R2 backend is selected. */
  MEDIA?: R2Bucket;
  /** Optional override for backend selection (`b2` or `r2`). */
  MEDIA_BACKEND?: string;
  /** Backblaze B2 S3-compatible endpoint, e.g. https://s3.us-west-004.backblazeb2.com */
  B2_ENDPOINT?: string;
  /** Backblaze B2 region identifier, e.g. us-west-004 */
  B2_REGION?: string;
  /** Backblaze B2 bucket name. */
  B2_BUCKET?: string;
  /** Backblaze B2 application key id. */
  B2_ACCESS_KEY_ID?: string;
  /** Backblaze B2 application key secret. */
  B2_SECRET_ACCESS_KEY?: string;
  ROOMS: DurableObjectNamespace;
  JWT_SECRET: string;
  DATA_ENCRYPTION_KEY: string;
  INTERNAL_SECRET: string;
  ALLOWED_ORIGINS: string;
  WEB_URL: string;
  EMAIL_FROM: string;
  RESEND_API_KEY?: string;
  HIBP_ENABLED?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
}

export interface AuthUser extends UserSummary {
  email: string;
  emailVerified: boolean;
  locale: 'en' | 'ar';
  sessionId: string;
  csrfHash: string;
  systemAdmin: boolean;
}

export interface Variables {
  requestId: string;
  user: AuthUser;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };
