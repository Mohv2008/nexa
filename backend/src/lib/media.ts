export interface SanitizedMedia {
  bytes: Uint8Array;
  mime: string;
  extension: string;
  kind: 'image' | 'audio' | 'file';
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Removes EXIF/XMP/comments while preserving encoded JPEG image data. */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (!startsWith(bytes, [0xff, 0xd8])) throw new TypeError('Invalid JPEG');
  const chunks: Uint8Array[] = [bytes.slice(0, 2)];
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) throw new TypeError('Invalid JPEG segment');
    const marker = bytes[offset + 1]!;
    if (marker === 0xda || marker === 0xd9) {
      chunks.push(bytes.slice(offset));
      return concat(chunks);
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      chunks.push(bytes.slice(offset, offset + 2));
      offset += 2;
      continue;
    }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (length < 2 || offset + 2 + length > bytes.length)
      throw new TypeError('Invalid JPEG length');
    // APP1 (EXIF/XMP), APP13 (Photoshop), APP14 and COM can contain identifying metadata.
    if (![0xe1, 0xed, 0xee, 0xfe].includes(marker)) {
      chunks.push(bytes.slice(offset, offset + 2 + length));
    }
    offset += 2 + length;
  }
  throw new TypeError('Truncated JPEG');
}

/** Keeps only render-critical PNG chunks, dropping text, EXIF, time, and unknown ancillary chunks. */
export function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  if (!startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) throw new TypeError('Invalid PNG');
  const chunks: Uint8Array[] = [bytes.slice(0, 8)];
  const allowed = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS']);
  let offset = 8;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
    const length = view.getUint32(0, false);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new TypeError('Invalid PNG chunk');
    const type = ascii(bytes, offset + 4, 4);
    if (allowed.has(type)) chunks.push(bytes.slice(offset, end));
    offset = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended) throw new TypeError('Truncated PNG');
  return concat(chunks);
}

/** Removes EXIF and XMP RIFF chunks from WebP without decoding image pixels. */
export function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    throw new TypeError('Invalid WebP');
  }
  const chunks: Uint8Array[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
    const paddedSize = size + (size % 2);
    const end = offset + 8 + paddedSize;
    if (end > bytes.length) throw new TypeError('Invalid WebP chunk');
    if (type !== 'EXIF' && type !== 'XMP ') chunks.push(bytes.slice(offset, end));
    offset = end;
  }
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(new TextEncoder().encode('RIFF'), 0);
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  header.set(new TextEncoder().encode('WEBP'), 8);
  return concat([header, body]);
}

export function inspectAndSanitize(bytes: Uint8Array, declaredType: string): SanitizedMedia | null {
  try {
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
      return {
        bytes: stripJpegMetadata(bytes),
        mime: 'image/jpeg',
        extension: 'jpg',
        kind: 'image',
      };
    }
    if (startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) {
      return { bytes: stripPngMetadata(bytes), mime: 'image/png', extension: 'png', kind: 'image' };
    }
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
      return {
        bytes: stripWebpMetadata(bytes),
        mime: 'image/webp',
        extension: 'webp',
        kind: 'image',
      };
    }
    if (ascii(bytes, 0, 4) === 'OggS') {
      return { bytes, mime: 'audio/ogg', extension: 'ogg', kind: 'audio' };
    }
    if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
      return { bytes, mime: 'audio/webm', extension: 'webm', kind: 'audio' };
    }
    if (ascii(bytes, 0, 5) === '%PDF-') {
      return { bytes, mime: 'application/pdf', extension: 'pdf', kind: 'file' };
    }
    if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
      return { bytes, mime: 'application/zip', extension: 'zip', kind: 'file' };
    }
    if (declaredType === 'text/plain' && bytes.length > 0 && !bytes.includes(0)) {
      // Fatal decoding rejects malformed UTF-8 and avoids content-sniffing binary data as text.
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return { bytes, mime: 'text/plain; charset=utf-8', extension: 'txt', kind: 'file' };
    }
  } catch {
    return null;
  }
  return null;
}
