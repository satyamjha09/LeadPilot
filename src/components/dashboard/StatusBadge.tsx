import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { LEAD_STATUS_BADGE_CLASS, LeadStatusLabel } from '@/src/lib/leadStatus';

export default function StatusBadge({ status }: { status: LeadStatusLabel | 'Failed' | '' }) {
  const label = status || '—';
  const styleKey = (status || 'Follow Up') as LeadStatusLabel | 'Failed';
  const className = LEAD_STATUS_BADGE_CLASS[styleKey] || LEAD_STATUS_BADGE_CLASS['Follow Up'];

  return (
    <Badge variant="outline" className={cn('font-medium', className)}>
      {label}
    </Badge>
  );
}
