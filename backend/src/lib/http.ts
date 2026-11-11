import { newId } from '@nexa/shared';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from './errors';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function allowedOrigins(value: string): Set<string> {
  return new Set(
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export const requestContext: MiddlewareHandler<AppEnv> = async (context, next) => {
  context.set('requestId', context.req.header('CF-Ray') ?? newId('req'));
  await next();
  context.header('X-Request-ID', context.get('requestId'));
};

export const securityHeaders: MiddlewareHandler<AppEnv> = async (context, next) => {
  await next();
  context.header(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  context.header('Cross-Origin-Opener-Policy', 'same-origin');
  context.header('Cross-Origin-Resource-Policy', 'same-site');
  context.header(
    'Permissions-Policy',
    'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  );
  context.header('Referrer-Policy', 'no-referrer');
  context.header('X-Content-Type-Options', 'nosniff');
  context.header('X-Frame-Options', 'DENY');
  if (new URL(context.req.url).protocol === 'https:') {
    context.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
};

export const corsAndOrigin: MiddlewareHandler<AppEnv> = async (context, next) => {
  const origin = context.req.header('Origin');
  const allowed = allowedOrigins(context.env.ALLOWED_ORIGINS);
  if (origin && !allowed.has(origin)) {
    if (WRITE_METHODS.has(context.req.method) || context.req.header('Upgrade') === 'websocket') {
      throw new ApiError('origin_denied', 'Request origin is not allowed.', 403);
    }
  }

  if (context.req.method === 'OPTIONS') {
    if (!origin || !allowed.has(origin)) {
      throw new ApiError('origin_denied', 'Request origin is not allowed.', 403);
    }
    context.header('Access-Control-Allow-Origin', origin);
    context.header('Access-Control-Allow-Credentials', 'true');
    context.header(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-CSRF-Token, X-Client-Version',
    );
    context.header('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
    context.header('Access-Control-Max-Age', '7200');
    context.header('Vary', 'Origin');
    return context.body(null, 204);
  }

  await next();
  if (origin && allowed.has(origin)) {
    context.header('Access-Control-Allow-Origin', origin);
    context.header('Access-Control-Allow-Credentials', 'true');
    context.header('Vary', 'Origin');
  }
  return undefined;
};

export function noStore(headers: Headers): void {
  headers.set('Cache-Control', 'no-store, max-age=0');
  headers.set('Pragma', 'no-cache');
}
