export const LEAD_STATUS = {
  DEMO_SCHEDULED: 'Demo Scheduled',
  DEMO_DONE: 'Demo Done',
  NO_RESPONSE: 'No Response',
  FOLLOW_UP: 'Follow Up',
  TO_BE_CALLED: 'To be called',
  NOT_REQUIRED: 'Not Required',
  REPEATED: 'Repeated',
  RESCHEDULE: 'Reschedule'
} as const;

export type LeadStatusValue = (typeof LEAD_STATUS)[keyof typeof LEAD_STATUS];

export const LEAD_STATUS_LIST: LeadStatusValue[] = [
  LEAD_STATUS.DEMO_SCHEDULED,
  LEAD_STATUS.DEMO_DONE,
  LEAD_STATUS.NO_RESPONSE,
  LEAD_STATUS.FOLLOW_UP,
  LEAD_STATUS.TO_BE_CALLED,
  LEAD_STATUS.NOT_REQUIRED,
  LEAD_STATUS.REPEATED,
  LEAD_STATUS.RESCHEDULE
];

export const EMAIL_TRIGGER_STATUSES: LeadStatusValue[] = [
  LEAD_STATUS.DEMO_SCHEDULED,
  LEAD_STATUS.DEMO_DONE
];

const STATUS_ALIASES: Record<string, LeadStatusValue> = {
  scheduled: LEAD_STATUS.DEMO_SCHEDULED,
  'demo schedule': LEAD_STATUS.DEMO_SCHEDULED,
  'demo shedule': LEAD_STATUS.DEMO_SCHEDULED,
  pending: LEAD_STATUS.FOLLOW_UP,
  skipped: LEAD_STATUS.FOLLOW_UP,
  failed: LEAD_STATUS.FOLLOW_UP
};

export function normalizeLeadStatus(value: unknown): LeadStatusValue | '' {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const exact = LEAD_STATUS_LIST.find((s) => s.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;

  const aliasKey = raw.toLowerCase().replace(/\s+/g, ' ');
  if (STATUS_ALIASES[aliasKey]) return STATUS_ALIASES[aliasKey];

  return '';
}

export function isValidLeadStatus(value: unknown): value is LeadStatusValue {
  return normalizeLeadStatus(value) !== '';
}

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
