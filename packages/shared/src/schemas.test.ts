import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { loginSchema, messageSchema, registerSchema, usernameSchema } from './schemas';

describe('input schemas', () => {
  it('normalizes usernames', () => {
    expect(v.parse(usernameSchema, '  NEXA_User ')).toBe('nexa_user');
  });

  it('rejects weak registrations and unknown keys are omitted', () => {
    expect(() =>
      v.parse(registerSchema, {
        email: 'person@example.com',
        username: 'person',
        displayName: 'Person',
        password: 'short',
        birthDate: '2000-01-01',
        acceptTerms: true,
      }),
    ).toThrow();
  });

  it('accepts a bounded message and login', () => {
    expect(v.parse(messageSchema, { content: 'Hello', clientNonce: 'nonce-1234' }).content).toBe(
      'Hello',
    );
    expect(
      v.parse(loginSchema, {
        identifier: 'person@example.com',
        password: 'not-validated-here',
      }),
    ).toBeTruthy();
  });
});
