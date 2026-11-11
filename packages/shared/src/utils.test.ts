import { describe, expect, it } from 'vitest';
import { cleanText, decodeCursor, encodeCursor, isAtLeastAge, safeFilename } from './utils';

describe('shared utilities', () => {
  it('round-trips opaque cursors', () => {
    const cursor = encodeCursor({ id: 'post_123', timestamp: 42 });
    expect(decodeCursor(cursor)).toEqual({ id: 'post_123', timestamp: 42 });
    expect(decodeCursor('!not-base64')).toBeNull();
  });

  it('evaluates age at the birthday boundary', () => {
    const now = new Date('2026-11-11T12:00:00Z');
    expect(isAtLeastAge('2013-11-11', 13, now)).toBe(true);
    expect(isAtLeastAge('2013-11-12', 13, now)).toBe(false);
    expect(isAtLeastAge('2020-02-30', 13, now)).toBe(false);
  });

  it('removes unsafe control and path characters', () => {
    expect(cleanText('hello\u0000 world')).toBe('hello world');
    expect(safeFilename('../../photo<script>.png')).not.toContain('..');
    expect(safeFilename('../../photo<script>.png')).not.toContain('<');
  });
});
