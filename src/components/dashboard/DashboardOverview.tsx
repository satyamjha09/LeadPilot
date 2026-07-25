import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  Mail,
  Send,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { canProcessLead } from '@/src/lib/rowUtils';
import { AuthStatus, DashboardActivityEvent, DashboardHealthSummary, DashboardTrendPoint, ExcelRow } from '@/src/types';
import { emailBrandLabel, type EmailBrandKey } from '@/src/lib/emailBrand';
import { senderAccountEmail, type SenderAccountKey, type WorkspaceKey } from '@/src/lib/senderAccount';

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

export default function DashboardOverview({
  rows,
  stats,
  trendData,
  activityEvents,
  healthSummary,
  authStatus,
  isAuthStatusLoading,
  workspaceKey,
  emailBrand,
  senderAccountKey,
  onViewAllActivity
}: {
  rows: ExcelRow[];
  stats: DashboardStats;
  trendData: DashboardTrendPoint[];
  activityEvents: DashboardActivityEvent[];
  healthSummary: DashboardHealthSummary | null;
  authStatus: AuthStatus | null;
  isAuthStatusLoading: boolean;
  workspaceKey: WorkspaceKey;
  emailBrand: EmailBrandKey;
  senderAccountKey: SenderAccountKey;
  onViewAllActivity: () => void;
}) {
  const total = Math.max(stats.total, 1);
  const positiveOutcomes = stats.demoScheduled + stats.demoDone;
  const actionedLeads = positiveOutcomes + stats.noResponse;
  const finalOutcomeTotal = positiveOutcomes + stats.noResponse + stats.failed;
  const positiveOutcomeRate = finalOutcomeTotal > 0 ? Math.round((positiveOutcomes / finalOutcomeTotal) * 100) : 0;
  const ready = rows.filter((row) => canProcessLead(row)).length;
  const workspaceIssues = stats.failed;
  const backendIssues = healthSummary?.issueCount ?? 0;
  const authIssue = !isAuthStatusLoading && (
    !authStatus?.configured ||
    !authStatus?.authenticated ||
    !!authStatus?.requiresReconnect ||
    !!authStatus?.authError
  );
  const issues = workspaceIssues + backendIssues + (authIssue ? 1 : 0);
  const sourceWorkspaceLabel = emailBrandLabel(workspaceKey);
  const brandLabel = emailBrandLabel(emailBrand);
  const senderEmail = authStatus?.connectedEmail || authStatus?.email || senderAccountEmail(senderAccountKey);
  const healthPercent = stats.total > 0 ? Math.min(100, Math.round((actionedLeads / total) * 100)) : 0;
  const healthMessage = issues > 0
    ? `${issues} health item${issues > 1 ? 's' : ''} need review`
    : 'Workspace health looks good';
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.9fr_1fr]">
        <Card className="tk-premium-card overflow-hidden border-sky-200/80 bg-gradient-to-br from-white via-sky-50/70 to-cyan-50/70 shadow-sm dark:border-sky-500/20 dark:from-slate-950 dark:via-sky-950/20 dark:to-slate-900">
          <CardContent className="p-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-sky-700 dark:text-sky-300">
                <Sparkles className="h-4 w-4" />
                Current Workspace Health
                <TrendingUp className="ml-1 h-4 w-4" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-normal text-slate-950 dark:text-white">
                  {healthMessage}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Workspace rows are scoped to {sourceWorkspaceLabel}; automation history is scoped to {brandLabel}.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <ScopePill label="Source Workspace" value={sourceWorkspaceLabel} />
                <ScopePill label="Email Brand" value={brandLabel} />
                <ScopePill label="Google Sender" value={senderEmail} />
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <Metric label="Total Leads" value={stats.total} />
                <Metric label="Workspace Issues" value={workspaceIssues} />
                <Metric label="Backend Issues" value={backendIssues} />
                <Metric label="Auth Issues" value={authIssue ? 1 : 0} />
              </div>
              <div className="space-y-2">
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-600"
                    style={{ width: `${healthPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Workspace actioned</span>
                  <span className="font-semibold text-foreground">{healthPercent}%</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="tk-premium-card self-start">
          <CardHeader className="px-4 pb-2 pt-4">
            <CardTitle className="text-base">Lead Outcome Rate</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-[120px_1fr] items-center gap-4 px-4 pb-4">
            <Donut value={positiveOutcomeRate} label="Positive Outcome" />
            <div className="space-y-2 text-sm">
              <LegendDot color="bg-emerald-500" label="Positive" value={positiveOutcomes} />
              <LegendDot color="bg-orange-500" label="Not Attended" value={stats.noResponse} />
              <LegendDot color="bg-red-500" label="Failed" value={stats.failed} />
              <LegendDot color="bg-amber-500" label="Pending" value={ready} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Pipeline stats={stats} total={total} />

      <div className="grid items-stretch gap-4 xl:grid-cols-[1fr_1.15fr]">
        <ActivityCard events={activityEvents.slice(0, 2)} onViewAllActivity={onViewAllActivity} />
        <TrendChart data={trendData} />
      </div>
    </div>
  );
}

function ScopePill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border bg-white/70 px-2 py-1 text-muted-foreground dark:bg-slate-950/45">
      <span className="font-medium text-foreground">{label}:</span>
      <span className="truncate">{value}</span>
    </span>
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

function Donut({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="grid h-28 w-28 place-items-center rounded-full"
      style={{ background: `conic-gradient(#10b981 ${value * 3.6}deg, #e5e7eb 0deg)` }}
    >
      <div className="grid h-20 w-20 place-items-center rounded-full bg-card text-center shadow-inner">
        <div>
          <div className="text-xl font-bold">{value}%</div>
          <div className="text-xs text-muted-foreground">{label}</div>
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
    { label: 'Scheduled Leads', value: stats.demoScheduled, icon: CalendarCheck2, color: 'cyan' },
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

function ActivityCard({ events, onViewAllActivity }: { events: DashboardActivityEvent[]; onViewAllActivity: () => void }) {
  return (
    <Card className="tk-premium-card flex h-full min-h-[220px] flex-col overflow-hidden">
      <CardHeader className="px-4 pb-3 pt-4">
        <CardTitle className="flex items-center gap-2 text-base">
          Recent Automation Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col px-4 pb-4">
        {events.length === 0 ? (
          <div className="flex flex-1 items-center">
            <p className="text-sm text-muted-foreground">No automation activity recorded yet.</p>
          </div>
        ) : (
          <div className="relative space-y-3">
            <span className="absolute left-[7px] top-5 h-[calc(100%-2.5rem)] w-px bg-slate-200 dark:bg-slate-800" />
            {events.map((item) => (
              <ActivityItem
                key={item.id}
                title={item.title}
                description={item.description}
                tone={item.tone}
                Icon={activityIcon(item)}
                time={formatActivityTime(item.occurredAt)}
                meta={item.meta}
              />
            ))}
          </div>
        )}
        <Button type="button" variant="ghost" size="sm" className="mt-auto h-8 w-full rounded-xl" onClick={onViewAllActivity}>
          View All Activity <ArrowRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
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

function formatActivityTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (absSeconds < 60) return formatter.format(diffSeconds, 'second');
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) return formatter.format(diffDays, 'day');
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
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

function TrendChart({ data }: { data: DashboardTrendPoint[] }) {
  const chartData = data.length ? data : [{ date: 'Today', count: 0 }];
  const max = Math.max(1, ...chartData.map((point) => point.count));
  const xStep = chartData.length > 1 ? 324 / (chartData.length - 1) : 0;
  const points = chartData
    .map((point, index) => {
      const x = chartData.length > 1 ? 24 + index * xStep : 186;
      const y = 132 - (point.count / max) * 96;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <Card className="tk-premium-card flex h-full min-h-[220px] flex-col">
      <CardHeader className="flex flex-row items-center justify-between px-4 pb-2 pt-4">
        <CardTitle className="text-base">Daily Scheduled Leads</CardTitle>
        <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">Last 7 Days</span>
      </CardHeader>
      <CardContent className="flex flex-1 items-center px-4 pb-4">
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
          {chartData.map((point, index) => {
            const x = chartData.length > 1 ? 24 + index * xStep : 186;
            const y = 132 - (point.count / max) * 96;
            return (
              <g key={point.date}>
                <circle cx={x} cy={y} r="4" fill="#fff" stroke="#0284c7" strokeWidth="3" />
                <text x={x} y={y - 12} textAnchor="middle" className="fill-muted-foreground text-[10px]">{point.count}</text>
                <text x={x} y="152" textAnchor="middle" className="fill-muted-foreground text-[10px]">{point.date.replace(/^[A-Za-z]+ /, '')}</text>
              </g>
            );
          })}
        </svg>
      </CardContent>
    </Card>
  );
}
