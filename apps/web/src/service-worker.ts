/// <reference lib="webworker" />

import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';

declare const self: ServiceWorkerGlobalScope;

const STATIC_CACHE = `nexa-static-${version}`;
const ASSETS = [...immutable, ...assets, ...prerendered]
  .map(({ path }) => (path.startsWith('/') ? path : `/${path}`))
  .filter((path) => path !== '/_headers' && path !== '/_redirects' && !path.endsWith('.webm'));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(ASSETS)));
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) =>
          key !== STATIC_CACHE && key.startsWith('nexa-static-')
            ? caches.delete(key)
            : Promise.resolve(false),
        ),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cachedRoute = await caches.match(request);
        if (cachedRoute) return cachedRoute;
        if (url.pathname.startsWith('/app')) {
          const appShell = (await caches.match('/app')) ?? (await caches.match('/app/'));
          if (appShell) return appShell;
        }
        return (await caches.match('/')) ?? (await caches.match('/200.html')) ?? Response.error();
      }),
    );
    return;
  }
  if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
  }
});

self.addEventListener('push', (event) => {
  let payload: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    payload = event.data?.json() as typeof payload;
  } catch {
    payload = { title: 'NEXA', body: event.data?.text() ?? 'You have a new notification.' };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'NEXA', {
      body: payload.body ?? 'You have a new notification.',
      icon: '/icons/nexa.svg',
      badge: '/icons/nexa.svg',
      tag: payload.tag ?? 'nexa-notification',
      data: { url: payload.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = String((event.notification.data as { url?: unknown } | null)?.url ?? '/');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const existing = clients.find(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      if (existing && 'focus' in existing) {
        await existing.focus();
        existing.postMessage({ type: 'navigate', url: target });
        return;
      }
      await self.clients.openWindow(target);
    }),
  );
});
