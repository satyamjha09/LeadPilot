import type { SourceRow } from '@prisma/client';

import type { IdentityCandidate } from './leadMatch.types';
import { identityScopeKey } from './leadIdentityScope';

export function normalizeLeadEmailIdentity(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeLeadPhoneIdentity(value: unknown) {
  const raw = String(value || '').trim();
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/[()\s-]/g, '').replace(/^\+/, '').replace(/\D/g, '');
  return digits ? `${hasPlus ? '+' : ''}${digits}` : '';
}

export function isValidLeadEmailIdentity(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isValidLeadPhoneIdentity(value: string) {
  const digits = value.replace(/^\+/, '');
  return /^\+?\d+$/.test(value) && digits.length >= 8 && digits.length <= 15;
}

export function buildIdentityCandidates(row: SourceRow): IdentityCandidate[] {
  const candidates: IdentityCandidate[] = [];
  const email = normalizeLeadEmailIdentity(row.email);
  const phone = normalizeLeadPhoneIdentity(row.phone);
  const crmId = String(row.crmId || '').trim();
  const automationId = String(row.automationId || '').trim();

  if (email && isValidLeadEmailIdentity(email)) {
    candidates.push({
      type: 'EMAIL',
      scopeKey: identityScopeKey('EMAIL', row.dataSourceId),
      value: email,
      isStrong: true
    });
  }

  if (phone && isValidLeadPhoneIdentity(phone)) {
    candidates.push({
      type: 'PHONE',
      scopeKey: identityScopeKey('PHONE', row.dataSourceId),
      value: phone,
      isStrong: true
    });
  }

  if (crmId) {
    candidates.push({
      type: 'CRM_ID',
      scopeKey: identityScopeKey('CRM_ID', row.dataSourceId),
      value: crmId,
      isStrong: true
    });
  }

  if (automationId) {
    candidates.push({
      type: 'AUTOMATION_ID',
      scopeKey: identityScopeKey('AUTOMATION_ID', row.dataSourceId),
      value: automationId,
      isStrong: false
    });
  }

  return candidates;
}
