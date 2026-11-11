import { describe, expect, it } from 'vitest';
import {
  base32Encode,
  decryptText,
  encryptText,
  hashPassword,
  signAccessToken,
  totpCode,
  verifyAccessToken,
  verifyPassword,
  verifyTotp,
} from './crypto';

describe('authentication cryptography', () => {
  it('hashes and verifies passwords without storing plaintext', async () => {
    const encoded = await hashPassword(
      'Correct Horse 7 Battery',
      100_000,
      new Uint8Array(16).fill(4),
    );
    expect(encoded).not.toContain('Correct Horse');
    await expect(verifyPassword('Correct Horse 7 Battery', encoded)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', encoded)).resolves.toBe(false);
    await expect(verifyPassword('anything', 'malformed')).resolves.toBe(false);
  });

  it('signs, validates, expires, and rejects tampered JWTs', async () => {
    const token = await signAccessToken('usr_123', 'ses_123', 'a'.repeat(32), 900, 1_000);
    expect((await verifyAccessToken(token, 'a'.repeat(32), 1_001))?.sub).toBe('usr_123');
    await expect(verifyAccessToken(token, 'a'.repeat(32), 1_901)).resolves.toBeNull();
    await expect(verifyAccessToken(`${token}x`, 'a'.repeat(32), 1_001)).resolves.toBeNull();
  });

  it('encrypts secrets with authenticated encryption', async () => {
    const encrypted = await encryptText('sensitive', btoa('z'.repeat(32)));
    expect(encrypted).not.toContain('sensitive');
    await expect(decryptText(encrypted, btoa('z'.repeat(32)))).resolves.toBe('sensitive');
    await expect(decryptText(`${encrypted}broken`, btoa('z'.repeat(32)))).resolves.toBeNull();
  });

  it('implements RFC-compatible six digit TOTP windows', async () => {
    const secret = base32Encode(new TextEncoder().encode('12345678901234567890'));
    await expect(totpCode(secret, 59_000)).resolves.toBe('287082');
    const current = await totpCode(secret, 1_700_000_000_000);
    await expect(verifyTotp(secret, current, 1_700_000_029_000)).resolves.toBe(true);
    await expect(verifyTotp(secret, 'abc123', 1_700_000_000_000)).resolves.toBe(false);
  });
});
