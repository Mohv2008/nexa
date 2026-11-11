import { describe, expect, it } from 'vitest';
import {
  inspectAndSanitize,
  stripJpegMetadata,
  stripPngMetadata,
  stripWebpMetadata,
} from './media';

describe('upload inspection', () => {
  it('rejects an HTML/SVG payload regardless of its claimed MIME', () => {
    const bytes = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    expect(inspectAndSanitize(bytes, 'image/png')).toBeNull();
  });

  it('accepts bounded UTF-8 plain text but rejects embedded NULs', () => {
    expect(inspectAndSanitize(new TextEncoder().encode('hello'), 'text/plain')?.extension).toBe(
      'txt',
    );
    expect(inspectAndSanitize(Uint8Array.from([65, 0, 66]), 'text/plain')).toBeNull();
  });

  it('drops JPEG APP1 metadata', () => {
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x06, 69, 88, 73, 70, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9,
    ]);
    const clean = stripJpegMetadata(jpeg);
    expect([...clean]).not.toContain(69);
    expect([...clean.slice(0, 2)]).toEqual([0xff, 0xd8]);
  });

  it('rejects malformed PNG chunks', () => {
    const truncated = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 1]);
    expect(() => stripPngMetadata(truncated)).toThrow();
  });

  it('recognizes the bounded file and voice allowlist', () => {
    expect(inspectAndSanitize(new TextEncoder().encode('%PDF-1.7\n'), 'text/html')?.mime).toBe(
      'application/pdf',
    );
    expect(inspectAndSanitize(Uint8Array.from([0x50, 0x4b, 3, 4, 0]), '')?.extension).toBe('zip');
    expect(inspectAndSanitize(new TextEncoder().encode('OggSvoice'), '')?.kind).toBe('audio');
    expect(inspectAndSanitize(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), '')?.mime).toBe(
      'audio/webm',
    );
    expect(inspectAndSanitize(new Uint8Array(), 'text/plain')).toBeNull();
  });

  it('drops WebP metadata chunks and rewrites the RIFF length', () => {
    const text = new TextEncoder();
    const makeChunk = (type: string, data: Uint8Array) => {
      const chunk = new Uint8Array(8 + data.length + (data.length % 2));
      chunk.set(text.encode(type), 0);
      new DataView(chunk.buffer).setUint32(4, data.length, true);
      chunk.set(data, 8);
      return chunk;
    };
    const body = [
      makeChunk('VP8 ', Uint8Array.from([1, 2])),
      makeChunk('EXIF', Uint8Array.from([9, 9])),
    ];
    const size = body.reduce((total, chunk) => total + chunk.length, 0);
    const webp = new Uint8Array(12 + size);
    webp.set(text.encode('RIFF'), 0);
    new DataView(webp.buffer).setUint32(4, size + 4, true);
    webp.set(text.encode('WEBP'), 8);
    let offset = 12;
    for (const chunk of body) {
      webp.set(chunk, offset);
      offset += chunk.length;
    }
    const clean = stripWebpMetadata(webp);
    expect(new TextDecoder().decode(clean)).not.toContain('EXIF');
    expect(inspectAndSanitize(clean, 'image/webp')?.mime).toBe('image/webp');
    expect(() => stripWebpMetadata(new TextEncoder().encode('not webp'))).toThrow();
  });
});
