import {
  AlertTriangle,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  Mail,
  Send,
  Sparkles
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DashboardActivityEvent } from '@/src/types';

export default function ActivityView({ events }: { events: DashboardActivityEvent[] }) {
  return (
    <Card className="tk-premium-card overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between border-b bg-sky-50/45 px-4 py-4 dark:bg-sky-950/20">
        <CardTitle className="flex items-center gap-2 text-base">
          Automation Activity
          <span className="font-semibold text-sky-600 dark:text-sky-300">(History)</span>
        </CardTitle>
        <span className="rounded-lg border bg-card px-2.5 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm">
          {events.length} item{events.length === 1 ? '' : 's'}
        </span>
      </CardHeader>
      <CardContent className="p-4">
        {events.length === 0 ? (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            No automation activity has been recorded for this brand yet.
          </p>
        ) : (
          <div className="relative space-y-3">
            <span className="absolute left-[7px] top-5 h-[calc(100%-2.5rem)] w-px bg-sky-200 dark:bg-sky-900" />
            {events.map((item) => (
              <div key={item.id}>
                <ActivityRow event={item} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({ event }: { event: DashboardActivityEvent }) {
  const Icon = activityIcon(event);
  const toneClasses =
    event.tone === 'failed'
      ? {
          dot: 'bg-red-500 ring-red-100 dark:ring-red-950',
          icon: 'border-red-100 bg-red-50 text-red-600 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300',
          badge: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
        }
      : event.tone === 'success'
        ? {
            dot: 'bg-emerald-500 ring-emerald-100 dark:ring-emerald-950',
            icon: 'border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300',
            badge: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
          }
        : {
            dot: 'bg-sky-500 ring-sky-100 dark:ring-sky-950',
            icon: 'border-sky-100 bg-sky-50 text-sky-600 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-300',
            badge: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300'
          };

  return (
    <div className="relative grid gap-3 rounded-xl border bg-white/78 p-3 shadow-sm backdrop-blur sm:grid-cols-[16px_44px_1fr_auto] dark:bg-slate-950/58">
      <span className={`relative z-10 mt-2 h-3.5 w-3.5 rounded-full ${toneClasses.dot} ring-4`} />
      <div className={`grid h-10 w-10 place-items-center rounded-xl border ${toneClasses.icon}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-slate-950 dark:text-white">{event.title}</p>
        <p className="truncate text-xs text-muted-foreground">{event.description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {event.meta && (
            <span className="inline-flex items-center gap-1">
              <Mail className="h-3.5 w-3.5" />
              {event.meta}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3.5 w-3.5" />
            {formatActivityDate(event.occurredAt)}
          </span>
        </div>
      </div>
      <span className={`h-fit whitespace-nowrap rounded-lg border px-2 py-1 text-xs font-semibold ${toneClasses.badge}`}>
        <Sparkles className="mr-1 inline h-3.5 w-3.5" />
        {event.status}
      </span>
    </div>
  );
}

function activityIcon(event: DashboardActivityEvent) {
  if (event.tone === 'failed') return AlertTriangle;
  if (event.type === 'lead-schedule') return CalendarCheck2;
  if (event.type === 'email-delivery') return Mail;
  if (event.type === 'sheet-sync') return FileSpreadsheet;
  if (event.tone === 'success') return CheckCircle2;
  return Send;
}

function formatActivityDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
