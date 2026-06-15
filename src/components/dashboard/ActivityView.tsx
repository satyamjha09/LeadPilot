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
import { LEAD_STATUS } from '@/src/lib/leadStatus';
import { getLeadStatus } from '@/src/lib/rowUtils';
import { ExcelRow } from '@/src/types';

export default function ActivityView({ rows }: { rows: ExcelRow[] }) {
  const activities = rows.map((row, index) => buildActivity(row, rows.length - index));

  return (
    <Card className="tk-premium-card overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between border-b bg-sky-50/45 px-4 py-4 dark:bg-sky-950/20">
        <CardTitle className="flex items-center gap-2 text-base">
          Automation Activity
          <span className="font-semibold text-sky-600 dark:text-sky-300">(All)</span>
        </CardTitle>
        <span className="rounded-lg border bg-card px-2.5 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm">
          {activities.length} item{activities.length === 1 ? '' : 's'}
        </span>
      </CardHeader>
      <CardContent className="p-4">
        {activities.length === 0 ? (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            Import a sheet to see activity.
          </p>
        ) : (
          <div className="relative space-y-3">
            <span className="absolute left-[7px] top-5 h-[calc(100%-2.5rem)] w-px bg-sky-200 dark:bg-sky-900" />
            {activities.map((item) => (
              <div key={`${item.title}-${item.index}`}>
                <ActivityRow {...item} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function buildActivity(row: ExcelRow, index: number) {
  const status = getLeadStatus(row);
  const failed = status === 'Failed';
  const success = status === LEAD_STATUS.DEMO_DONE || status === LEAD_STATUS.DEMO_SCHEDULED;
  const pending = status === LEAD_STATUS.FOLLOW_UP || status === LEAD_STATUS.TO_BE_CALLED;
  const Icon = failed
    ? AlertTriangle
    : success
      ? status === LEAD_STATUS.DEMO_DONE ? CheckCircle2 : CalendarCheck2
      : pending
        ? Send
        : FileSpreadsheet;

  return {
    index,
    title: `Lead #${index} - ${row.full_name || 'Unnamed lead'}`,
    description: String(row.Remarks || status || 'Waiting for next action'),
    status: status || 'No Status',
    tone: failed ? 'failed' : success ? 'success' : 'progress',
    Icon,
    email: String(row.email || '-'),
    demoDate: String(row['Date of Demo'] || '-'),
    demoTime: String(row['Time of Demo'] || '-')
  };
}

function ActivityRow({
  title,
  description,
  status,
  tone,
  Icon,
  email,
  demoDate,
  demoTime
}: ReturnType<typeof buildActivity>) {
  const toneClasses =
    tone === 'failed'
      ? {
          dot: 'bg-red-500 ring-red-100 dark:ring-red-950',
          icon: 'border-red-100 bg-red-50 text-red-600 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300',
          badge: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
        }
      : tone === 'success'
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
        <p className="truncate text-sm font-bold text-slate-950 dark:text-white">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Mail className="h-3.5 w-3.5" />
            {email}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3.5 w-3.5" />
            {demoDate} {demoTime}
          </span>
        </div>
      </div>
      <span className={`h-fit whitespace-nowrap rounded-lg border px-2 py-1 text-xs font-semibold ${toneClasses.badge}`}>
        <Sparkles className="mr-1 inline h-3.5 w-3.5" />
        {status}
      </span>
    </div>
  );
}
