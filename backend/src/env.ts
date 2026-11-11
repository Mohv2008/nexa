import type { UserSummary } from '@nexa/shared';

export interface Bindings {
  DB: D1Database;
  MEDIA: R2Bucket;
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
