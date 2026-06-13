import { CalendarPlus, CheckCircle2, ClipboardCheck, Loader2, Mail, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { ScheduleSummary, SheetSource } from '@/src/types';

interface ProcessingPanelProps {
  isProcessing: boolean;
  processingProgress: {
    current: number;
    total: number;
    success: number;
    failed: number;
    skipped: number;
    currentEmail?: string;
    currentName?: string;
    currentStep?: string;
    stepIndex?: number;
    steps?: string[];
  } | null;
  lastSummary: ScheduleSummary | null;
  source: SheetSource;
  onExport?: () => void;
}

export default function ProcessingPanel({
  isProcessing,
  processingProgress,
  lastSummary,
  source,
  onExport
}: ProcessingPanelProps) {
  if (!isProcessing && !lastSummary) return null;

  if (isProcessing && processingProgress) {
    const steps = processingProgress.steps?.length
      ? processingProgress.steps
      : ['Validating lead', 'Creating calendar', 'Sending email', 'Updating sheet', 'Done'];
    const currentStep = processingProgress.currentStep || steps[processingProgress.stepIndex || 0] || steps[0];
    const matchedStepIndex = steps.findIndex((step) => step === currentStep);
    const stepIndex = matchedStepIndex >= 0 ? matchedStepIndex : 0;
    const percent =
      processingProgress.total > 0
        ? Math.round((processingProgress.current / processingProgress.total) * 100)
        : 0;

    return (
      <Card className="tk-hover-card overflow-hidden border-sky-200/70 bg-sky-50/30 dark:border-sky-900/50 dark:bg-sky-950/20">
        <CardHeader className="border-b bg-card/80">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </span>
                Running automation
              </CardTitle>
              <CardDescription>
                Processing {processingProgress.current} of {processingProgress.total} leads
              </CardDescription>
            </div>
            <div className="rounded-full border bg-background px-3 py-1 text-sm font-semibold text-sky-700 dark:text-sky-300">
              {percent}%
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={percent} />
          <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
            <div className="rounded-lg border bg-card p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Current work
              </div>
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Lead</div>
                <div className="font-semibold">
                  {processingProgress.currentName || processingProgress.currentEmail || 'Preparing batch'}
                </div>
                {processingProgress.currentEmail && processingProgress.currentName && (
                  <div className="break-all text-sm text-muted-foreground">{processingProgress.currentEmail}</div>
                )}
                <div className="pt-2 text-sm">
                  Step: <span className="font-semibold text-foreground">{currentStep}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="rounded-lg border bg-card p-3">
                <div className="font-semibold text-emerald-600">{processingProgress.success}</div>
                <div className="text-muted-foreground">Done</div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="font-semibold text-destructive">{processingProgress.failed}</div>
                <div className="text-muted-foreground">Failed</div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="font-semibold">{processingProgress.skipped}</div>
                <div className="text-muted-foreground">Skipped</div>
              </div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-5">
            {steps.map((step, index) => (
              <div
                key={step}
                className={`rounded-lg border p-3 text-xs ${
                  index < stepIndex
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : index === stepIndex
                      ? 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-300'
                      : 'bg-card text-muted-foreground'
                }`}
              >
                <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/80">
                  {stepIcon(step, index === stepIndex)}
                </div>
                <div className="font-medium">{step}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!lastSummary) return null;

  const total = lastSummary.totalRows ?? lastSummary.total ?? 0;

  return (
    <Card className="tk-hover-card border-emerald-200/60 bg-emerald-50/30 dark:border-emerald-900/40 dark:bg-emerald-950/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          Processing complete
        </CardTitle>
        <CardDescription>Batch processing finished for {total} row(s)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-9">
          <SummaryItem label="Total" value={total} />
          <SummaryItem label="Meetings scheduled" value={lastSummary.demoScheduled ?? lastSummary.scheduled} />
          <SummaryItem label="Meetings rescheduled" value={lastSummary.reschedule ?? 0} />
          <SummaryItem label="Thank-you sent" value={lastSummary.demoDone ?? 0} />
          <SummaryItem label="No Response" value={lastSummary.noResponse ?? 0} />
          <SummaryItem label="Status-only" value={lastSummary.statusOnly ?? 0} />
          <SummaryItem label="Time conflicts" value={lastSummary.timeConflicts ?? 0} />
          <SummaryItem label="Invalid rows" value={lastSummary.failed} />
          <SummaryItem label="Skipped" value={lastSummary.skipped} />
        </div>
        {source.type === 'google-sheet' ? (
          <p className="text-sm text-muted-foreground">
            Google Sheet updated directly. No download required.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">Download your updated Excel file with meeting results.</p>
            {onExport && (
              <Button type="button" size="sm" onClick={onExport}>
                Download Updated Excel
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function stepIcon(step: string, active: boolean) {
  const className = `h-4 w-4 ${active ? 'animate-pulse' : ''}`;
  if (/validating/i.test(step)) return <ClipboardCheck className={className} />;
  if (/calendar/i.test(step)) return <CalendarPlus className={className} />;
  if (/email/i.test(step)) return <Mail className={className} />;
  if (/sheet/i.test(step)) return <RefreshCw className={className} />;
  return <CheckCircle2 className={className} />;
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="tk-hover-card rounded-lg border bg-card p-3 text-center">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
