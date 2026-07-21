import { CalendarCheck2, CheckCircle2, Clock3, List, Phone, RotateCw, UserX, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Stats = {
  total: number;
  demoScheduled: number;
  demoDone: number;
  readyToSchedule: number;
  failed: number;
  followUp: number;
  noResponse: number;
  reschedule: number;
};

const items = [
  { key: 'total', label: 'Total Leads', description: 'Imported rows', icon: List },
  { key: 'readyToSchedule', label: 'Ready to Schedule', description: 'Valid demo rows', icon: Clock3 },
  { key: 'demoScheduled', label: 'Scheduled Leads', description: 'Invite workflow done', icon: CalendarCheck2 },
  { key: 'reschedule', label: 'Reschedule', description: 'Needs active demo update', icon: RotateCw },
  { key: 'demoDone', label: 'Demo Done', description: 'Thank-you workflow done', icon: CheckCircle2 },
  { key: 'noResponse', label: 'Not Attended', description: 'Closed missed demos', icon: UserX },
  { key: 'followUp', label: 'Follow Up', description: 'Waiting for action', icon: Phone },
  { key: 'failed', label: 'Needs Fix', description: 'Rows with clear errors', icon: XCircle }
] as const;

export default function StatsCards({ stats }: { stats: Stats }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
      {items.map(({ key, label, description, icon: Icon }) => (
        <Card key={key} className="tk-hover-card rounded-md shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            <Icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats[key]}</div>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
