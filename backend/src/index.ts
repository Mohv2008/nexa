import { APP_NAME } from '@nexa/shared';
import { Hono } from 'hono';
import type { AppEnv } from './env';
import { RealtimeRoom } from './durable/realtime-room';
import { ApiError } from './lib/errors';
import { corsAndOrigin, noStore, requestContext, securityHeaders } from './lib/http';
import { openApi } from './openapi';
import admin from './routes/admin';
import auth from './routes/auth';
import communities from './routes/communities';
import messaging from './routes/messaging';
import realtime from './routes/realtime';
import social from './routes/social';
import uploads from './routes/uploads';

const app = new Hono<AppEnv>();

app.use('*', requestContext);
app.use('*', corsAndOrigin);
app.use('*', securityHeaders);
app.use('/v1/auth/*', async (context, next) => {
  await next();
  noStore(context.res.headers);
});

app.get('/', (context) =>
  context.json({
    name: `${APP_NAME} API`,
    version: '0.1.0',
    documentation: '/v1/openapi.json',
  }),
);

app.get('/health', async (context) => {
  const started = performance.now();
  await context.env.DB.prepare('SELECT 1 AS healthy').first();
  return context.json({
    status: 'ok',
    service: 'nexa-api',
    timestamp: new Date().toISOString(),
    database: 'ok',
    latencyMs: Math.round(performance.now() - started),
  });
});

app.get('/v1/openapi.json', (context) => context.json(openApi));

app.route('/v1/auth', auth);
app.route('/v1', uploads);
app.route('/v1', social);
app.route('/v1', communities);
app.route('/v1', messaging);
app.route('/v1', realtime);
app.route('/v1', admin);

app.notFound((context) =>
  context.json(
    {
      error: {
        code: 'not_found',
        message: 'The requested endpoint was not found.',
        requestId: context.get('requestId'),
      },
    },
    404,
  ),
);

app.onError((error, context) => {
  if (error instanceof ApiError) {
    return context.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          requestId: context.get('requestId'),
        },
      },
      error.status,
    );
  }
  // Deliberately exclude request bodies, authorization headers, cookies, and user PII.
  console.error(
    JSON.stringify({
      level: 'error',
      requestId: context.get('requestId'),
      method: context.req.method,
      path: new URL(context.req.url).pathname,
      error: error instanceof Error ? error.name : 'UnknownError',
    }),
  );
  return context.json(
    {
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        requestId: context.get('requestId'),
      },
    },
    500,
  );
});

export { RealtimeRoom };
export default app;
