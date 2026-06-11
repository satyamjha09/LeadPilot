import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { LEAD_STATUS_BADGE_CLASS, LeadStatusLabel } from '@/src/lib/leadStatus';

export default function StatusBadge({ status }: { status: LeadStatusLabel | 'Failed' | '' }) {
  const className = status
    ? LEAD_STATUS_BADGE_CLASS[status as LeadStatusLabel | 'Failed']
    : 'border-border bg-muted text-muted-foreground';

  return (
    <Badge variant="outline" className={cn('font-medium', className)}>
      {status || '-'}
    </Badge>
  );
}
