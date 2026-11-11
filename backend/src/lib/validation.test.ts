import { Hono } from 'hono';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import type { AppEnv, Bindings } from '../env';
import { ApiError } from './errors';
import { boundedInteger, parseJson } from './validation';

const app = new Hono<AppEnv>();
app.post('/parse', async (context) => {
  const input = await parseJson(
    context,
    v.object({ name: v.pipe(v.string(), v.minLength(2), v.maxLength(20)) }),
    128,
  );
  return context.json(input);
});
app.onError((error, context) =>
  error instanceof ApiError
    ? context.json({ code: error.code, details: error.details }, error.status)
    : context.json({ code: 'unknown' }, 500),
);

const bindings = {} as Bindings;

describe('request validation', () => {
  it('parses valid JSON and rejects schema issues', async () => {
    const valid = await app.request(
      '/parse',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"NEXA"}' },
      bindings,
    );
    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toEqual({ name: 'NEXA' });

    const invalid = await app.request(
      '/parse',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"x"}' },
      bindings,
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: 'validation_failed' });
  });

  it('rejects wrong media types, malformed JSON, and declared or measured oversize bodies', async () => {
    expect(
      (
        await app.request(
          '/parse',
          { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' },
          bindings,
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await app.request(
          '/parse',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' },
          bindings,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          '/parse',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': '999' },
            body: '{}',
          },
          bindings,
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await app.request(
          '/parse',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'x'.repeat(200) }),
          },
          bindings,
        )
      ).status,
    ).toBe(413);
  });

  it('bounds pagination integers', () => {
    expect(boundedInteger(undefined, 30, 1, 100)).toBe(30);
    expect(boundedInteger('25', 30, 1, 100)).toBe(25);
    expect(boundedInteger('0', 30, 1, 100)).toBe(30);
    expect(boundedInteger('101', 30, 1, 100)).toBe(30);
    expect(boundedInteger('not-a-number', 30, 1, 100)).toBe(30);
  });
});
