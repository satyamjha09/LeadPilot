import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { LEAD_STATUS, LEAD_STATUS_BADGE_CLASS, LeadStatusLabel } from '@/src/lib/leadStatus';

const STATUS_LABELS: Record<string, string> = {
  [LEAD_STATUS.DEMO_SCHEDULED]: 'Scheduled',
  [LEAD_STATUS.DEMO_DONE]: 'Demo Done',
  [LEAD_STATUS.NO_RESPONSE]: 'No Response',
  [LEAD_STATUS.RESCHEDULE]: 'Reschedule',
  [LEAD_STATUS.FOLLOW_UP]: 'Follow Up',
  [LEAD_STATUS.TO_BE_CALLED]: 'To Be Called',
  [LEAD_STATUS.NOT_REQUIRED]: 'Not Required',
  [LEAD_STATUS.REPEATED]: 'Repeated',
  Failed: 'Failed',
  'Email Pending': 'Email Pending',
  'Manual Review': 'Manual Review',
  'Sheet Sync Pending': 'Sheet Sync Pending'
};

const STATUS_CLASSES: Record<string, string> = {
  ...LEAD_STATUS_BADGE_CLASS,
  'Email Pending': 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300',
  'Manual Review': 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-300',
  'Sheet Sync Pending': 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-300'
};

export default function StatusBadge({ status }: { status: LeadStatusLabel | 'Failed' | string | '' }) {
  const className = status ? STATUS_CLASSES[status] : 'border-border bg-muted text-muted-foreground';
  const label = status ? STATUS_LABELS[status] || status : '-';

  return (
    <Badge variant="outline" className={cn('w-fit whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', className)}>
      {label}
    </Badge>
  );
}
