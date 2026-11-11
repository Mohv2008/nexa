const CACHE_NAME = 'nexa-private-api-v1';

function canCache(url: string): boolean {
  return /\/(feed|servers|channels\/[^/]+\/messages|conversations|notifications)(?:[/?]|$)/u.test(
    url,
  );
}

export async function cacheApiResponse(url: string, response: Response): Promise<void> {
  if (!('caches' in globalThis) || !canCache(url) || !response.ok) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(url, response);
}

export async function cachedApiResponse(url: string): Promise<Response | undefined> {
  if (!('caches' in globalThis) || !canCache(url)) return undefined;
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match(url)) ?? undefined;
}

export async function clearPrivateCache(): Promise<void> {
  if ('caches' in globalThis) await caches.delete(CACHE_NAME);
}
