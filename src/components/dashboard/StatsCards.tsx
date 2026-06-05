import { CalendarCheck2, CheckCircle2, Clock3, List, Phone, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Stats = {
  total: number;
  demoScheduled: number;
  demoDone: number;
  readyToSchedule: number;
  failed: number;
  followUp: number;
};

const items = [
  { key: 'total', label: 'Total Leads', description: 'Imported rows', icon: List },
  { key: 'readyToSchedule', label: 'Ready to Schedule', description: 'Can send meeting email', icon: Clock3 },
  { key: 'demoScheduled', label: 'Demo Scheduled', description: 'Meeting email sent', icon: CalendarCheck2 },
  { key: 'demoDone', label: 'Demo Done', description: 'Thank-you sent', icon: CheckCircle2 },
  { key: 'followUp', label: 'Follow Up', description: 'No email', icon: Phone },
  { key: 'failed', label: 'Needs Fix', description: 'Validation errors', icon: XCircle }
] as const;

export default function StatsCards({ stats }: { stats: Stats }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {items.map(({ key, label, description, icon: Icon }) => (
        <Card key={key} className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            <Icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats[key]}</div>
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
