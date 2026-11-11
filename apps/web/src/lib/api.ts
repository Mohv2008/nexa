import { cachedApiResponse, cacheApiResponse, clearPrivateCache } from './cache';
import { config } from './config';
import { currentPreferences } from './preferences';

export interface ApiFailure {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken = '';
let refreshing: Promise<boolean> | null = null;

function endpoint(path: string): string {
  return `${config.apiUrl.replace(/\/$/u, '')}/${path.replace(/^\//u, '')}`;
}

async function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const response = await fetch(endpoint('/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Client-Version': config.version },
      });
      if (!response.ok) return false;
      const payload = (await response.json()) as { data?: { csrfToken?: string } };
      csrfToken = payload.data?.csrfToken ?? '';
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export function setCsrfToken(value: string): void {
  csrfToken = value;
}

export async function api<T>(
  path: string,
  options: RequestInit & { retryAuth?: boolean; cacheOffline?: boolean } = {},
): Promise<T> {
  const url = endpoint(path);
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  headers.set('X-Client-Version', config.version);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  let response: Response;
  try {
    response = await fetch(url, { ...options, method, headers, credentials: 'include' });
  } catch (error) {
    if (method === 'GET' && options.cacheOffline !== false && currentPreferences().offlineCache) {
      const cached = await cachedApiResponse(url);
      if (cached) return (await cached.json()) as T;
    }
    throw new ApiError('network_error', 'Unable to reach NEXA. Check your connection.', 0, error);
  }
  if (response.status === 401 && options.retryAuth !== false && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, { ...options, retryAuth: false });
  }
  if (!response.ok) {
    let failure: ApiFailure | null = null;
    try {
      failure = (await response.json()) as ApiFailure;
    } catch {
      // Keep the generic message for non-JSON gateway errors.
    }
    throw new ApiError(
      failure?.error.code ?? 'request_failed',
      failure?.error.message ?? `Request failed (${response.status}).`,
      response.status,
      failure?.error.details,
    );
  }
  if (response.status === 204) return undefined as T;
  if (method === 'GET' && options.cacheOffline !== false && currentPreferences().offlineCache) {
    // Clone synchronously before JSON consumption; Cache API opening is asynchronous.
    void cacheApiResponse(url, response.clone()).catch(() => undefined);
  }
  return (await response.json()) as T;
}

export async function bootstrapSession(): Promise<boolean> {
  return refreshSession();
}

export async function logout(): Promise<void> {
  try {
    await api('/auth/logout', { method: 'POST', retryAuth: false });
  } finally {
    csrfToken = '';
    await clearPrivateCache();
  }
}
