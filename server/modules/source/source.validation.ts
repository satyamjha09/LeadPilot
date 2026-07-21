import type { DataSourceType } from '@prisma/client';

export function normalizeExternalFileId(type: DataSourceType, value: unknown) {
  const normalized = String(value || '').trim();
  if (type === 'GOOGLE_SHEETS' && !normalized) {
    throw new Error('Google Sheets sources require an externalFileId spreadsheet ID.');
  }
  return normalized || null;
}

export function normalizeExternalTabId(value: unknown) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error('Source tabs require an externalTabId.');
  }
  return normalized;
}

export function normalizeHeaders(headers: unknown) {
  if (!Array.isArray(headers)) {
    throw new Error('Source tab headers must be an array.');
  }
  return headers.map((header) => String(header || '').trim());
}

export function normalizeEmailIdentity(email: unknown) {
  const normalized = String(email || '').trim().toLowerCase();
  return normalized || null;
}
