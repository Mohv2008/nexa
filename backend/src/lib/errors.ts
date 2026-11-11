import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class ApiError extends Error {
  readonly code: string;
  readonly status: ContentfulStatusCode;
  readonly details?: unknown;

  constructor(code: string, message: string, status: ContentfulStatusCode, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

export function notFound(message = 'The requested resource was not found.'): never {
  throw new ApiError('not_found', message, 404);
}

export function forbidden(message = 'You do not have permission to do that.'): never {
  throw new ApiError('forbidden', message, 403);
}

export function conflict(message: string): never {
  throw new ApiError('conflict', message, 409);
}
