/** Change this single value to rebrand all NEXA clients and server metadata. */
export const APP_NAME = 'NEXA' as const;

export const APP_CONFIG = Object.freeze({
  name: APP_NAME,
  description: 'Your people, conversations, and communities in one place.',
  minAge: 13,
  maxCommunityName: 80,
  maxPostLength: 5_000,
  maxMessageLength: 4_000,
  maxBioLength: 300,
  accessTokenSeconds: 15 * 60,
  refreshTokenSeconds: 30 * 24 * 60 * 60,
  maxUploadBytes: 20 * 1024 * 1024,
  maxImageBytes: 8 * 1024 * 1024,
  maxVoiceBytes: 10 * 1024 * 1024,
  maxVoicePeers: 6,
  pageSize: 30,
} as const);

export const SUPPORTED_LOCALES = ['en', 'ar'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
