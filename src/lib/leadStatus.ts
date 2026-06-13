export {
  LEAD_STATUS,
  LEAD_STATUS_OPTIONS,
  getLeadStatusParse,
  isValidLeadStatus,
  normalizeHeader,
  normalizeLeadStatus,
  normalizeToken,
  type LeadStatusLabel
} from './leadStatusCore';

import { LEAD_STATUS, type LeadStatusLabel, normalizeLeadStatus } from './leadStatusCore';

export function getRowLeadStatus(value: unknown): LeadStatusLabel | 'Failed' | '' {
  if (String(value || '').trim().toLowerCase() === 'failed') return 'Failed';
  return normalizeLeadStatus(value) || '';
}

export const LEAD_STATUS_BADGE_CLASS: Record<LeadStatusLabel | 'Failed', string> = {
  [LEAD_STATUS.DEMO_DONE]: 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900/50 dark:bg-teal-950/40 dark:text-teal-300',
  [LEAD_STATUS.DEMO_SCHEDULED]: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300',
  [LEAD_STATUS.NO_RESPONSE]: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300',
  [LEAD_STATUS.FOLLOW_UP]: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300',
  [LEAD_STATUS.TO_BE_CALLED]: 'border-border bg-muted text-muted-foreground',
  [LEAD_STATUS.NOT_REQUIRED]: 'border-destructive/30 bg-destructive/10 text-destructive',
  [LEAD_STATUS.REPEATED]: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300',
  [LEAD_STATUS.RESCHEDULE]: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-300',
  Failed: 'border-destructive/30 bg-destructive/10 text-destructive'
};
