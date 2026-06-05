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

export type LeadStatusLabel = (typeof LEAD_STATUS)[keyof typeof LEAD_STATUS];

export const LEAD_STATUS_OPTIONS: LeadStatusLabel[] = [
  LEAD_STATUS.DEMO_SCHEDULED,
  LEAD_STATUS.DEMO_DONE,
  LEAD_STATUS.NO_RESPONSE,
  LEAD_STATUS.FOLLOW_UP,
  LEAD_STATUS.TO_BE_CALLED,
  LEAD_STATUS.NOT_REQUIRED,
  LEAD_STATUS.REPEATED,
  LEAD_STATUS.RESCHEDULE
];

const ALIASES: Record<string, LeadStatusLabel> = {
  scheduled: LEAD_STATUS.DEMO_SCHEDULED,
  pending: LEAD_STATUS.FOLLOW_UP,
  skipped: LEAD_STATUS.FOLLOW_UP
};

export function normalizeLeadStatus(value: unknown): LeadStatusLabel | '' {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const exact = LEAD_STATUS_OPTIONS.find((s) => s.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;

  const key = raw.toLowerCase().replace(/\s+/g, ' ');
  return ALIASES[key] || '';
}

export function getRowLeadStatus(value: unknown): LeadStatusLabel | 'Failed' | '' {
  if (String(value || '').toLowerCase() === 'failed') return 'Failed';
  return normalizeLeadStatus(value) || '';
}

export const LEAD_STATUS_BADGE_CLASS: Record<LeadStatusLabel | 'Failed', string> = {
  [LEAD_STATUS.DEMO_DONE]: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300',
  [LEAD_STATUS.DEMO_SCHEDULED]: 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-300',
  [LEAD_STATUS.NO_RESPONSE]: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-900/50 dark:bg-fuchsia-950/40 dark:text-fuchsia-300',
  [LEAD_STATUS.FOLLOW_UP]: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300',
  [LEAD_STATUS.TO_BE_CALLED]: 'border-border bg-muted text-muted-foreground',
  [LEAD_STATUS.NOT_REQUIRED]: 'border-destructive/30 bg-destructive/10 text-destructive',
  [LEAD_STATUS.REPEATED]: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300',
  [LEAD_STATUS.RESCHEDULE]: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-300',
  Failed: 'border-destructive/30 bg-destructive/10 text-destructive'
};
