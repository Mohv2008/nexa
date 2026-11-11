import * as v from 'valibot';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from './errors';

type AnySchema = v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;

function issuePath(issue: v.BaseIssue<unknown>): string {
  if (!issue.path) return '$';
  return issue.path
    .map((item) => String(item.key))
    .filter(Boolean)
    .join('.');
}

export async function parseJson<TSchema extends AnySchema>(
  context: Context<AppEnv>,
  schema: TSchema,
  maximumBytes = 64 * 1024,
): Promise<v.InferOutput<TSchema>> {
  const length = Number(context.req.header('Content-Length') ?? 0);
  if (Number.isFinite(length) && length > maximumBytes) {
    throw new ApiError('payload_too_large', 'Request body is too large.', 413);
  }
  const contentType = context.req.header('Content-Type')?.split(';')[0]?.trim();
  if (contentType !== 'application/json') {
    throw new ApiError('unsupported_media_type', 'Content-Type must be application/json.', 415);
  }
  const text = await context.req.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new ApiError('payload_too_large', 'Request body is too large.', 413);
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new ApiError('invalid_json', 'Request body contains invalid JSON.', 400);
  }
  const result = v.safeParse(schema, input, { abortEarly: false });
  if (!result.success) {
    throw new ApiError(
      'validation_failed',
      'One or more fields are invalid.',
      400,
      result.issues
        .slice(0, 20)
        .map((issue) => ({ path: issuePath(issue), message: issue.message })),
    );
  }
  return result.output;
}

export function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}
