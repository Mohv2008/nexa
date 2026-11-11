import { constantTimeEqual } from '@nexa/shared';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
// Cloudflare Workers caps Web Crypto PBKDF2 at 100,000 iterations and rejects
// anything higher with NotSupportedError ("iteration counts above 100000 are
// not supported"). 100,000 is therefore the strongest value the platform
// allows; it is the value stored hashes are created with and re-verified at.
const PASSWORD_ITERATIONS = 100_000;

// TypeScript 7 distinguishes SharedArrayBuffer-backed views from Web Crypto's
// ArrayBuffer-only BufferSource. Copy untrusted views before cryptographic use.
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomToken(length = 32): string {
  return toBase64Url(randomBytes(length));
}

export async function sha256(value: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

export async function hashPassword(
  password: string,
  iterations = PASSWORD_ITERATIONS,
  salt = randomBytes(16),
): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: asArrayBuffer(salt), iterations },
    material,
    256,
  );
  return `pbkdf2-sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationText, saltText, expectedText] = encoded.split('$');
  const iterations = Number(iterationText);
  if (
    algorithm !== 'pbkdf2-sha256' ||
    !Number.isSafeInteger(iterations) ||
    iterations < 100_000 ||
    !saltText ||
    !expectedText
  ) {
    return false;
  }
  try {
    const candidate = await hashPassword(password, iterations, fromBase64Url(saltText));
    const candidateHash = candidate.split('$')[3];
    return Boolean(
      candidateHash && constantTimeEqual(fromBase64Url(candidateHash), fromBase64Url(expectedText)),
    );
  } catch {
    return false;
  }
}

export interface AccessClaims {
  sub: string;
  sid: string;
  type: 'access';
  iss: 'nexa';
  iat: number;
  exp: number;
  jti: string;
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function signAccessToken(
  subject: string,
  sessionId: string,
  secret: string,
  lifetimeSeconds: number,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const claims: AccessClaims = {
    sub: subject,
    sid: sessionId,
    type: 'access',
    iss: 'nexa',
    iat: now,
    exp: now + lifetimeSeconds,
    jti: crypto.randomUUID(),
  };
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = toBase64Url(await hmac(secret, `${header}.${payload}`));
  return `${header}.${payload}.${signature}`;
}

export async function verifyAccessToken(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Promise<AccessClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) return null;
  try {
    const parsedHeader: unknown = JSON.parse(decoder.decode(fromBase64Url(header)));
    const claims: unknown = JSON.parse(decoder.decode(fromBase64Url(payload)));
    const expected = await hmac(secret, `${header}.${payload}`);
    if (!constantTimeEqual(expected, fromBase64Url(signature))) return null;
    if (
      !parsedHeader ||
      typeof parsedHeader !== 'object' ||
      (parsedHeader as { alg?: unknown }).alg !== 'HS256' ||
      !claims ||
      typeof claims !== 'object'
    ) {
      return null;
    }
    const value = claims as Partial<AccessClaims>;
    if (
      typeof value.sub !== 'string' ||
      typeof value.sid !== 'string' ||
      value.type !== 'access' ||
      value.iss !== 'nexa' ||
      typeof value.iat !== 'number' ||
      typeof value.exp !== 'number' ||
      typeof value.jti !== 'string' ||
      value.exp <= now ||
      value.iat > now + 60
    ) {
      return null;
    }
    return value as AccessClaims;
  } catch {
    return null;
  }
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(secret);
  } catch {
    bytes = encoder.encode(secret);
  }
  if (bytes.byteLength !== 32) {
    bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', asArrayBuffer(bytes)));
  }
  return crypto.subtle.importKey('raw', asArrayBuffer(bytes), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptText(value: string, secret: string): Promise<string> {
  const iv = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asArrayBuffer(iv) },
    await encryptionKey(secret),
    encoder.encode(value),
  );
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptText(value: string, secret: string): Promise<string | null> {
  const [iv, encrypted] = value.split('.');
  if (!iv || !encrypted) return null;
  try {
    const clear = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asArrayBuffer(fromBase64Url(iv)) },
      await encryptionKey(secret),
      asArrayBuffer(fromBase64Url(encrypted)),
    );
    return decoder.decode(clear);
  } catch {
    return null;
  }
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(value: string): Uint8Array {
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of value.toUpperCase().replace(/=+$/u, '')) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new TypeError('Invalid base32');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

export async function totpCode(secret: string, time = Date.now()): Promise<string> {
  const counter = Math.floor(time / 30_000);
  const bytes = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = remaining & 255;
    remaining = Math.floor(remaining / 256);
  }
  const key = await crypto.subtle.importKey(
    'raw',
    asArrayBuffer(base32Decode(secret)),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  const offset = (digest[digest.length - 1] ?? 0) & 15;
  const binary =
    (((digest[offset] ?? 0) & 127) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, '0');
}

export async function verifyTotp(
  secret: string,
  code: string,
  time = Date.now(),
): Promise<boolean> {
  if (!/^\d{6}$/u.test(code)) return false;
  const candidates = await Promise.all(
    [-30_000, 0, 30_000].map((offset) => totpCode(secret, time + offset)),
  );
  return candidates.some((candidate) => candidate === code);
}

export async function isBreachedPassword(password: string, request = fetch): Promise<boolean> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', encoder.encode(password)));
  const hex = [...digest]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  const response = await request(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`, {
    headers: { 'Add-Padding': 'true', 'User-Agent': 'NEXA password safety check' },
  });
  if (!response.ok) return false;
  const suffix = hex.slice(5);
  return (await response.text()).split(/\r?\n/u).some((line) => line.split(':')[0] === suffix);
}
