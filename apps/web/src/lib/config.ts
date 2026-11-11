import { APP_CONFIG } from '@nexa/shared';

export const config = Object.freeze({
  ...APP_CONFIG,
  apiUrl: (import.meta.env.PUBLIC_API_URL as string | undefined) ?? 'http://localhost:8787/v1',
  webUrl: (import.meta.env.PUBLIC_WEB_URL as string | undefined) ?? 'http://localhost:5173',
  version: '0.1.0',
});
