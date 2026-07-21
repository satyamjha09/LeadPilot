import { createHash } from 'node:crypto';

export function normalizeSourceHeaders(values: unknown[]) {
  return values.map((value) =>
    String(value ?? '')
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim()
  );
}

export function createHeaderHash(headers: string[]) {
  return createHash('sha256').update(JSON.stringify(headers)).digest('hex');
}
