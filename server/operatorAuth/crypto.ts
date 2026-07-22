import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const MAX_PASSWORD_LENGTH = 1024;
const WEAK_PASSWORDS = new Set([
  'password',
  'password123',
  '123456789012',
  'adminpassword',
  'leadpilotadmin'
]);

export function normalizeOperatorEmail(email: unknown) {
  return String(email || '').trim().toLowerCase();
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function newSecretToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function validateOperatorPassword(password: unknown) {
  const value = String(password || '');
  if (value.length < 12) {
    throw new Error('Operator password must be at least 12 characters.');
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    throw new Error('Operator password is too long.');
  }
  if (WEAK_PASSWORDS.has(value.trim().toLowerCase())) {
    throw new Error('Operator password is too weak.');
  }
}

export function hashOperatorPassword(password: string) {
  validateOperatorPassword(password);
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024
  });
  return [
    'scrypt',
    'v=1',
    `N=${SCRYPT_N}`,
    `r=${SCRYPT_R}`,
    `p=${SCRYPT_P}`,
    `len=${SCRYPT_KEY_LENGTH}`,
    salt.toString('base64url'),
    hash.toString('base64url')
  ].join('$');
}

export function verifyOperatorPassword(password: string, encodedHash: string) {
  try {
    const parts = String(encodedHash || '').split('$');
    if (parts.length !== 8 || parts[0] !== 'scrypt' || parts[1] !== 'v=1') return false;

    const params = Object.fromEntries(parts.slice(2, 6).map((part) => part.split('=')));
    const N = Number(params.N);
    const r = Number(params.r);
    const p = Number(params.p);
    const keyLength = Number(params.len);
    if (!N || !r || !p || !keyLength) return false;

    const salt = Buffer.from(parts[6], 'base64url');
    const expected = Buffer.from(parts[7], 'base64url');
    const actual = scryptSync(password, salt, keyLength, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function timingSafeHashCompare(rawValue: string, expectedHash: string) {
  const actual = Buffer.from(sha256(rawValue));
  const expected = Buffer.from(expectedHash || '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
