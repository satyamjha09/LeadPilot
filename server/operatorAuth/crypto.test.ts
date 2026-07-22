import { describe, expect, it } from 'vitest';
import {
  hashOperatorPassword,
  normalizeOperatorEmail,
  timingSafeHashCompare,
  validateOperatorPassword,
  verifyOperatorPassword,
  sha256
} from './crypto';

describe('operator auth crypto', () => {
  it('normalizes operator email deterministically', () => {
    expect(normalizeOperatorEmail(' Admin@Example.COM ')).toBe('admin@example.com');
  });

  it('hashes and verifies passwords without storing plaintext', () => {
    const hash = hashOperatorPassword('a very strong operator password');
    expect(hash).toMatch(/^scrypt\$v=1\$/);
    expect(hash).not.toContain('a very strong operator password');
    expect(verifyOperatorPassword('a very strong operator password', hash)).toBe(true);
    expect(verifyOperatorPassword('wrong operator password', hash)).toBe(false);
  });

  it('rejects short and weak operator passwords', () => {
    expect(() => validateOperatorPassword('short')).toThrow(/at least 12/);
    expect(() => validateOperatorPassword('leadpilotadmin')).toThrow(/weak/);
  });

  it('compares CSRF/session hashes without accepting mismatches', () => {
    const token = 'csrf-token';
    expect(timingSafeHashCompare(token, sha256(token))).toBe(true);
    expect(timingSafeHashCompare('other-token', sha256(token))).toBe(false);
  });
});
