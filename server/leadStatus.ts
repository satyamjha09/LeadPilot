export {
  LEAD_STATUS,
  LEAD_STATUS_OPTIONS as LEAD_STATUS_LIST,
  getLeadStatusParse,
  isValidLeadStatus,
  normalizeHeader,
  normalizeLeadStatus,
  normalizeToken,
  type LeadStatusLabel as LeadStatusValue
} from '../src/lib/leadStatusCore';

import { LEAD_STATUS, normalizeLeadStatus, type LeadStatusLabel } from '../src/lib/leadStatusCore';

export const EMAIL_TRIGGER_STATUSES: LeadStatusLabel[] = [
  LEAD_STATUS.DEMO_SCHEDULED,
  LEAD_STATUS.DEMO_DONE
];

export function isDemoScheduledStatus(value: unknown) {
  return normalizeLeadStatus(value) === LEAD_STATUS.DEMO_SCHEDULED;
}

export function isDemoDoneStatus(value: unknown) {
  return normalizeLeadStatus(value) === LEAD_STATUS.DEMO_DONE;
}

export function isEmailTriggerStatus(value: unknown) {
  const normalized = normalizeLeadStatus(value);
  return normalized !== '' && EMAIL_TRIGGER_STATUSES.includes(normalized);
}
