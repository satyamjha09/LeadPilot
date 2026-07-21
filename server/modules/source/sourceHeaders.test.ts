import { describe, expect, it } from 'vitest';

import { createHeaderHash, normalizeSourceHeaders } from './sourceHeaders';

describe('source header utilities', () => {
  it('normalizes whitespace and invisible unicode while preserving order', () => {
    expect(normalizeSourceHeaders([' full_name ', '\u200Bemail', 'lead_status\uFEFF'])).toEqual([
      'full_name',
      'email',
      'lead_status'
    ]);
  });

  it('creates a stable sha256 hash from ordered headers', () => {
    const headers = ['full_name', 'email', 'lead_status'];
    expect(createHeaderHash(headers)).toBe(createHeaderHash(headers));
    expect(createHeaderHash(headers)).not.toBe(createHeaderHash([...headers].reverse()));
    expect(createHeaderHash(headers)).toMatch(/^[a-f0-9]{64}$/);
  });
});
