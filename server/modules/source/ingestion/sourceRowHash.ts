import { createHash } from 'node:crypto';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function createSourceRowHash(input: {
  headerHash: string;
  values: unknown[];
  normalizedFields: Record<string, unknown>;
}) {
  return createHash('sha256')
    .update(
      stableStringify({
        headerHash: input.headerHash,
        values: input.values.map((value) => String(value ?? '').normalize('NFKC').trim()),
        normalizedFields: input.normalizedFields
      })
    )
    .digest('hex');
}
