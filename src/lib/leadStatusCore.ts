export const LEAD_STATUS = {
  DEMO_SCHEDULED: 'Demo Scheduled',
  RESCHEDULE: 'Reschedule',
  DEMO_DONE: 'Demo Done',
  FOLLOW_UP: 'Follow Up',
  NO_RESPONSE: 'No Response',
  TO_BE_CALLED: 'To be called',
  NOT_REQUIRED: 'not required',
  REPEATED: 'Repeated'
} as const;

export type LeadStatusLabel = (typeof LEAD_STATUS)[keyof typeof LEAD_STATUS];

export const LEAD_STATUS_OPTIONS: LeadStatusLabel[] = [
  LEAD_STATUS.DEMO_SCHEDULED,
  LEAD_STATUS.RESCHEDULE,
  LEAD_STATUS.DEMO_DONE,
  LEAD_STATUS.FOLLOW_UP,
  LEAD_STATUS.NO_RESPONSE,
  LEAD_STATUS.TO_BE_CALLED,
  LEAD_STATUS.NOT_REQUIRED,
  LEAD_STATUS.REPEATED
];

export function normalizeToken(value: unknown) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[_\-\s]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeHeader(value: unknown) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const STATUS_ALIASES: Record<string, LeadStatusLabel> = {
  'demo scheduled': LEAD_STATUS.DEMO_SCHEDULED,
  'demo schedule': LEAD_STATUS.DEMO_SCHEDULED,
  'demo shedule': LEAD_STATUS.DEMO_SCHEDULED,
  scheduled: LEAD_STATUS.DEMO_SCHEDULED,
  reschedule: LEAD_STATUS.RESCHEDULE,
  rescheduled: LEAD_STATUS.RESCHEDULE,
  're schedule': LEAD_STATUS.RESCHEDULE,
  reshedule: LEAD_STATUS.RESCHEDULE,
  resheduled: LEAD_STATUS.RESCHEDULE,
  'demo done': LEAD_STATUS.DEMO_DONE,
  completed: LEAD_STATUS.DEMO_DONE,
  done: LEAD_STATUS.DEMO_DONE,
  'follow up': LEAD_STATUS.FOLLOW_UP,
  followup: LEAD_STATUS.FOLLOW_UP,
  'no response': LEAD_STATUS.NO_RESPONSE,
  'no show': LEAD_STATUS.NO_RESPONSE,
  'to be called': LEAD_STATUS.TO_BE_CALLED,
  'not required': LEAD_STATUS.NOT_REQUIRED,
  'notrequired': LEAD_STATUS.NOT_REQUIRED,
  repeated: LEAD_STATUS.REPEATED
};

export function normalizeLeadStatus(value: unknown): LeadStatusLabel | '' {
  const key = normalizeToken(value);
  if (!key) return '';
  return STATUS_ALIASES[key] || '';
}

export function getLeadStatusParse(value: unknown) {
  const raw = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  const normalized = normalizeLeadStatus(raw);
  return {
    raw,
    normalized,
    isBlank: raw === '',
    isKnown: normalized !== ''
  };
}

export function isValidLeadStatus(value: unknown): value is LeadStatusLabel {
  return normalizeLeadStatus(value) !== '';
}
