import type { LeadIdentityType } from '@prisma/client';
import type { LeadMatchInput } from './lead.types';

export function normalizeLeadEmail(email: unknown) {
  const normalized = String(email || '').trim().toLowerCase();
  return normalized || null;
}

export function buildLeadIdentityCandidates(input: LeadMatchInput) {
  const candidates: Array<{ type: LeadIdentityType; value: string }> = [];
  const email = normalizeLeadEmail(input.email);
  if (email) candidates.push({ type: 'EMAIL', value: email });

  const phone = String(input.phone || '').replace(/\D+/g, '');
  if (phone) candidates.push({ type: 'PHONE', value: phone });

  const automationId = String(input.automationId || '').trim();
  if (automationId) candidates.push({ type: 'AUTOMATION_ID', value: automationId });

  const crmId = String(input.crmId || '').trim();
  if (crmId) candidates.push({ type: 'CRM_ID', value: crmId });

  return candidates;
}
