import { CheckCircle2, Loader2 } from 'lucide-react';
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
    const percent =
      processingProgress.total > 0
        ? Math.round((processingProgress.current / processingProgress.total) * 100)
        : 0;

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing in progress
          </CardTitle>
          <CardDescription>
            Processing {processingProgress.current} of {processingProgress.total} selected leads
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={percent} />
          {processingProgress.currentEmail && (
            <p className="text-sm text-muted-foreground">
              Current: <span className="font-medium text-foreground">{processingProgress.currentEmail}</span>
            </p>
          )}
          <div className="grid grid-cols-3 gap-3 text-center text-sm">
            <div className="rounded-lg border p-2">
              <div className="font-semibold text-emerald-600">{processingProgress.success}</div>
              <div className="text-muted-foreground">Scheduled</div>
            </div>
            <div className="rounded-lg border p-2">
              <div className="font-semibold text-destructive">{processingProgress.failed}</div>
              <div className="text-muted-foreground">Failed</div>
            </div>
            <div className="rounded-lg border p-2">
              <div className="font-semibold">{processingProgress.skipped}</div>
              <div className="text-muted-foreground">Skipped</div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!lastSummary) return null;

  const total = lastSummary.totalRows ?? lastSummary.total ?? 0;

  return (
    <Card className="border-emerald-200/60 bg-emerald-50/30 dark:border-emerald-900/40 dark:bg-emerald-950/20">
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

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-3 text-center">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
