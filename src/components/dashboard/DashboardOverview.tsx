import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  Mail,
  Play,
  Send,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  XCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LEAD_STATUS } from '@/src/lib/leadStatus';
import { canProcessLead, getLeadStatus } from '@/src/lib/rowUtils';
import { ExcelRow } from '@/src/types';

type DashboardStats = {
  total: number;
  demoScheduled: number;
  demoDone: number;
  readyToSchedule: number;
  failed: number;
  followUp: number;
  noResponse: number;
  reschedule: number;
};

const trendData = [32, 45, 38, 62, 58, 67, 55];
const trendLabels = ['May 16', 'May 17', 'May 18', 'May 19', 'May 20', 'May 21', 'May 22'];

export default function DashboardOverview({
  rows,
  stats,
  selectedCount,
  onRunAutomation,
  onViewAllActivity
}: {
  rows: ExcelRow[];
  stats: DashboardStats;
  selectedCount: number;
  onRunAutomation: () => void;
  onViewAllActivity: () => void;
}) {
  const total = Math.max(stats.total, 1);
  const processed = stats.demoScheduled + stats.demoDone + stats.noResponse;
  const successRate = processed + stats.failed > 0 ? Math.round((processed / (processed + stats.failed)) * 100) : 100;
  const ready = rows.filter((row) => canProcessLead(row)).length;
  const issues = stats.failed;
  const healthPercent = Math.min(100, Math.round((processed / total) * 100));
  const statusSlices = [
    { label: 'Ready to Schedule', value: stats.readyToSchedule, color: '#3b82f6' },
    { label: 'Demo Scheduled', value: stats.demoScheduled, color: '#22c7d8' },
    { label: 'Demo Done', value: stats.demoDone, color: '#22c55e' },
    { label: 'Not Attended', value: stats.noResponse, color: '#fb923c' },
    { label: 'Failed / Needs Fix', value: stats.failed, color: '#ef4444' },
    { label: 'Follow Up', value: stats.followUp, color: '#38bdf8' }
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.9fr_1fr]">
        <Card className="tk-premium-card overflow-hidden border-sky-200/80 bg-gradient-to-br from-white via-sky-50/70 to-cyan-50/70 shadow-sm dark:border-sky-500/20 dark:from-slate-950 dark:via-sky-950/20 dark:to-slate-900">
          <CardContent className="grid gap-4 p-4 lg:grid-cols-[1.55fr_0.85fr]">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-sky-700 dark:text-sky-300">
                <Sparkles className="h-4 w-4" />
                Today's Automation Health
                <TrendingUp className="ml-1 h-4 w-4" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-normal text-slate-950 dark:text-white">
                  {issues > 0 ? `${issues} item${issues > 1 ? 's' : ''} need review` : 'Everything is running smoothly!'}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  TallyKonnect is tracking demos, email delivery, reminders, and sheet updates.
                </p>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <Metric label="Total Leads" value={stats.total} />
                <Metric label="Processed" value={processed} />
                <Metric label="Issues" value={issues} />
              </div>
              <div className="space-y-2">
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-600"
                    style={{ width: `${healthPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Automation completion</span>
                  <span className="font-semibold text-foreground">{healthPercent}%</span>
                </div>
              </div>
            </div>
            <div className="rounded-xl border bg-white/70 p-4 shadow-sm backdrop-blur dark:bg-slate-950/45">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next Up</p>
              <div className="mt-3 text-xl font-bold">{ready} leads ready</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Estimated time: ~{Math.max(1, Math.ceil(ready * 0.6))} mins
              </p>
              <Button
                type="button"
                className="mt-4 h-9 w-full bg-gradient-to-r from-sky-500 to-cyan-600 text-white shadow-lg shadow-sky-500/20 hover:from-sky-400 hover:to-cyan-500"
                onClick={onRunAutomation}
                disabled={selectedCount === 0}
              >
                <Play className="h-4 w-4" />
                Run Automation
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="tk-premium-card self-start">
          <CardHeader className="px-4 pb-2 pt-4">
            <CardTitle className="text-base">Automation Efficiency</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-[120px_1fr] items-center gap-4 px-4 pb-4">
            <Donut value={successRate} />
            <div className="space-y-2 text-sm">
              <LegendDot color="bg-emerald-500" label="Success" value={processed} />
              <LegendDot color="bg-red-500" label="Failed" value={stats.failed} />
              <LegendDot color="bg-amber-500" label="Pending" value={ready} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Pipeline stats={stats} total={total} />

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_1fr_1.15fr]">
        <ActivityCard rows={rows} onViewAllActivity={onViewAllActivity} />
        <LeadsStatusChart slices={statusSlices} total={stats.total} />
        <TrendChart />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span className="text-lg font-bold">{value}</span>
      <span className="ml-2 text-muted-foreground">{label}</span>
    </div>
  );
}

function Donut({ value }: { value: number }) {
  return (
    <div
      className="grid h-28 w-28 place-items-center rounded-full"
      style={{ background: `conic-gradient(#10b981 ${value * 3.6}deg, #e5e7eb 0deg)` }}
    >
      <div className="grid h-20 w-20 place-items-center rounded-full bg-card text-center shadow-inner">
        <div>
          <div className="text-xl font-bold">{value}%</div>
          <div className="text-xs text-muted-foreground">Success Rate</div>
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <span className="min-w-8 font-semibold">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function Pipeline({ stats, total }: { stats: DashboardStats; total: number }) {
  const items = [
    { label: 'Imported', value: stats.total, icon: Users, color: 'sky' },
    { label: 'Ready to Schedule', value: stats.readyToSchedule, icon: Send, color: 'blue' },
    { label: 'Demo Scheduled', value: stats.demoScheduled, icon: CalendarCheck2, color: 'cyan' },
    { label: 'Demo Done', value: stats.demoDone, icon: CheckCircle2, color: 'green' },
    { label: 'Not Attended', value: stats.noResponse, icon: Mail, color: 'orange' },
    { label: 'Failed / Needs Fix', value: stats.failed, icon: AlertTriangle, color: 'red' }
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      {items.map((item, index) => {
        const Icon = item.icon;
        const percent = Math.round((item.value / total) * 100);
        return (
          <div key={item.label} className="relative">
            <Card className="tk-premium-card h-full">
              <CardContent className="flex items-center gap-3 p-3">
                <div className={`tk-pipeline-icon tk-pipeline-${item.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-muted-foreground">{item.label}</p>
                  <div className="text-lg font-bold">{item.value}</div>
                  <p className="text-xs text-muted-foreground">{percent}%</p>
                </div>
              </CardContent>
            </Card>
            {index < items.length - 1 && (
              <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 text-muted-foreground xl:block" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ActivityCard({ rows, onViewAllActivity }: { rows: ExcelRow[]; onViewAllActivity: () => void }) {
  const activity = rows.slice(0, 5).map((row, index) => {
    const status = getLeadStatus(row);
    const failed = status === 'Failed';
    const success = status === LEAD_STATUS.DEMO_DONE || status === LEAD_STATUS.DEMO_SCHEDULED;
    const icon = failed ? AlertTriangle : success ? (index % 2 === 0 ? CheckCircle2 : CalendarCheck2) : (index % 2 === 0 ? Send : FileSpreadsheet);
    return {
      title: `Lead #${rows.length - index} - ${row.full_name || 'Unnamed lead'}`,
      description: String(row.Remarks || (success ? 'Workflow updated successfully' : 'Waiting for next action')),
      tone: failed ? 'failed' : success ? 'success' : 'progress',
      icon,
      time: index === 0 ? 'Just now' : `${index * 2 - 1} min ago`,
      meta: failed ? 'Invalid email address' : undefined
    };
  });

  return (
    <Card className="tk-premium-card h-fit overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between px-4 pb-3 pt-4">
        <CardTitle className="flex items-center gap-2 text-base">
          Automation Activity
          <span className="font-semibold text-sky-600 dark:text-sky-300">(Live)</span>
          <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-950">
            <span className="absolute h-3 w-3 animate-ping rounded-full bg-sky-400/60" />
            <span className="h-2 w-2 rounded-full bg-sky-600" />
          </span>
        </CardTitle>
        <span className="inline-flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Live Updates
        </span>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">Import a sheet to see live automation activity.</p>
        ) : (
          <div className="relative space-y-3">
            <span className="absolute left-[7px] top-5 h-[calc(100%-2.5rem)] w-px bg-slate-200 dark:bg-slate-800" />
            {activity.map((item) => (
              <ActivityItem
                key={item.title}
                title={item.title}
                description={item.description}
                tone={item.tone}
                Icon={item.icon}
                time={item.time}
                meta={item.meta}
              />
            ))}
          </div>
        )}
        <Button type="button" variant="ghost" size="sm" className="mt-3 h-8 w-full rounded-xl" onClick={onViewAllActivity}>
          View All Activity <ArrowRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

function ActivityItem({
  title,
  description,
  tone,
  Icon,
  time,
  meta
}: {
  key?: string;
  title: string;
  description: string;
  tone: string;
  Icon: typeof Send;
  time: string;
  meta?: string;
}) {
  const toneClass = tone === 'failed' ? 'red' : tone === 'success' ? 'green' : 'sky';
  const dotClass =
    toneClass === 'red'
      ? 'bg-red-500 ring-red-100 dark:ring-red-950'
      : toneClass === 'green'
        ? 'bg-emerald-500 ring-emerald-100 dark:ring-emerald-950'
        : 'bg-blue-500 ring-blue-100 dark:ring-blue-950';
  const iconClass =
    toneClass === 'red'
      ? 'border-red-100 bg-red-50 text-red-600 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300'
      : toneClass === 'green'
        ? 'border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300'
        : 'border-blue-100 bg-blue-50 text-blue-600 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-300';
  const badgeClass =
    toneClass === 'red'
      ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
      : toneClass === 'green'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
        : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300';
  const badge =
    tone === 'failed' ? 'Failed' : tone === 'success' ? 'Success' : 'In Progress';

  return (
    <div className="relative grid grid-cols-[16px_44px_1fr_auto] items-start gap-3">
      <span className={`relative z-10 mt-2 h-3.5 w-3.5 rounded-full ${dotClass} ring-4`} />
      <div className={`grid h-10 w-10 place-items-center rounded-xl border ${iconClass}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-slate-950 dark:text-white">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{description}</p>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3.5 w-3.5" />
            {time}
          </span>
          {meta && (
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              {meta}
            </span>
          )}
        </div>
      </div>
      <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold ${badgeClass}`}>
        {tone === 'success' && <CheckCircle2 className="h-3.5 w-3.5" />}
        {tone === 'failed' && <AlertTriangle className="h-3.5 w-3.5" />}
        {tone === 'progress' && <Sparkles className="h-3.5 w-3.5" />}
        {badge}
      </span>
    </div>
  );
}

function LeadsStatusChart({ slices, total }: { slices: Array<{ label: string; value: number; color: string }>; total: number }) {
  const gradient = buildConicGradient(slices);
  return (
    <Card className="tk-premium-card h-fit">
      <CardHeader className="px-4 pb-3 pt-4">
        <CardTitle className="text-base">Leads by Status</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 px-4 pb-4 sm:grid-cols-[126px_1fr]">
        <div className="grid h-32 w-32 place-items-center rounded-full" style={{ background: gradient }}>
          <div className="grid h-20 w-20 place-items-center rounded-full bg-card text-center shadow-inner">
            <div>
              <div className="text-2xl font-bold">{total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          {slices.map((slice) => {
            const percent = total > 0 ? ((slice.value / total) * 100).toFixed(1) : '0.0';
            return (
              <div key={slice.label} className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: slice.color }} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{slice.label}</span>
                <span className="font-semibold">{slice.value} ({percent}%)</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function buildConicGradient(slices: Array<{ value: number; color: string }>) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (!total) return 'conic-gradient(#e5e7eb 0 360deg)';
  let start = 0;
  const stops = slices.map((slice) => {
    const end = start + (slice.value / total) * 360;
    const stop = `${slice.color} ${start}deg ${end}deg`;
    start = end;
    return stop;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

function TrendChart() {
  const max = Math.max(...trendData);
  const points = trendData
    .map((value, index) => {
      const x = 24 + index * 54;
      const y = 132 - (value / max) * 96;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <Card className="tk-premium-card h-fit">
      <CardHeader className="flex flex-row items-center justify-between px-4 pb-2 pt-4">
        <CardTitle className="text-base">Daily Automation Trend</CardTitle>
        <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">Last 7 Days</span>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <svg viewBox="0 0 360 160" className="h-40 w-full overflow-visible">
          <defs>
            <linearGradient id="tkTrend" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[32, 68, 104, 140].map((y) => (
            <line key={y} x1="20" x2="350" y1={y} y2={y} stroke="currentColor" className="text-border" strokeDasharray="4 4" />
          ))}
          <polygon points={`24,140 ${points} 348,140`} fill="url(#tkTrend)" />
          <polyline points={points} fill="none" stroke="#0284c7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {trendData.map((value, index) => {
            const x = 24 + index * 54;
              const y = 132 - (value / max) * 96;
            return (
              <g key={trendLabels[index]}>
                <circle cx={x} cy={y} r="4" fill="#fff" stroke="#0284c7" strokeWidth="3" />
                <text x={x} y={y - 12} textAnchor="middle" className="fill-muted-foreground text-[10px]">{value}</text>
                <text x={x} y="152" textAnchor="middle" className="fill-muted-foreground text-[10px]">{trendLabels[index].replace('May ', '')}</text>
              </g>
            );
          })}
        </svg>
      </CardContent>
    </Card>
  );
}
