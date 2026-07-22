import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Clock3, Eye, Mail, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import RowDetailsDialog from '@/src/components/dashboard/RowDetailsDialog';
import StatusBadge from '@/src/components/dashboard/StatusBadge';
import {
  formatDateTime,
  formatLogType,
  formatSheetSyncStatus,
  formatStatus,
  isFailedEmailStatus,
  isNeedsReviewStatus,
  isSheetSyncIssue,
  type EmailHistoryLog,
  type SheetSyncJob
} from '@/src/components/dashboard/reviewTypes';
import { getLeadStatus } from '@/src/lib/rowUtils';
import { emailBrandLabel, type EmailBrandKey } from '@/src/lib/emailBrand';
import type { WorkspaceKey } from '@/src/lib/senderAccount';
import { ExcelRow } from '@/src/types';
import { apiFetch } from '@/src/lib/authClient';

export default function ManualReviewView({
  rows,
  workspaceKey,
  selectedEmailBrand
}: {
  rows: ExcelRow[];
  workspaceKey: WorkspaceKey;
  selectedEmailBrand: EmailBrandKey;
}) {
  const [detailsRow, setDetailsRow] = useState<ExcelRow | null>(null);

  return (
    <>
      <Card className="tk-premium-card overflow-hidden">
        <CardHeader className="border-b bg-amber-50/50 dark:bg-amber-950/20">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                Manual Review Queue
              </CardTitle>
              <CardDescription>
                Failed emails, unclear Gmail results, and pending Google Sheet retries.
              </CardDescription>
            </div>
            <Badge variant="outline" className="w-fit rounded-full px-3 py-1">
              {rows.length} lead{rows.length === 1 ? '' : 's'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          {rows.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
              No manual review items right now.
            </div>
          ) : (
            rows.map((row) => (
              <div key={row.id}>
                <ManualReviewRow
                  row={row}
                  workspaceKey={workspaceKey}
                  selectedEmailBrand={selectedEmailBrand}
                  onViewDetails={() => setDetailsRow(row)}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <RowDetailsDialog
        row={detailsRow}
        workspaceKey={workspaceKey}
        selectedEmailBrand={selectedEmailBrand}
        open={!!detailsRow}
        onOpenChange={(open) => !open && setDetailsRow(null)}
      />
    </>
  );
}

function ManualReviewRow({
  row,
  workspaceKey,
  selectedEmailBrand,
  onViewDetails
}: {
  row: ExcelRow;
  workspaceKey: WorkspaceKey;
  selectedEmailBrand: EmailBrandKey;
  onViewDetails: () => void;
}) {
  const [logs, setLogs] = useState<EmailHistoryLog[]>([]);
  const [sheetJobs, setSheetJobs] = useState<SheetSyncJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);

  const loadReviewData = useCallback(async () => {
    const businessEmailBrand = row.__emailBrand || selectedEmailBrand;
    const sourceWorkspaceKey = row.__workspaceKey || workspaceKey;
    setIsLoading(true);
    try {
      const [emailRes, sheetRes] = await Promise.all([
        apiFetch('/api/leads/email-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ row, emailBrand: businessEmailBrand })
        }),
        apiFetch('/api/sheet-sync/jobs-for-row', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ row, workspaceKey: sourceWorkspaceKey, emailBrand: businessEmailBrand })
        })
      ]);

      const emailData = await emailRes.json().catch(() => ({}));
      const sheetData = await sheetRes.json().catch(() => ({}));
      if (!emailRes.ok) throw new Error(emailData.error || 'Could not load email review status.');
      if (!sheetRes.ok) throw new Error(sheetData.error || 'Could not load sheet sync status.');

      setLogs(Array.isArray(emailData.logs) ? emailData.logs : []);
      setSheetJobs(Array.isArray(sheetData.jobs) ? sheetData.jobs.filter(Boolean) : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load review status.');
    } finally {
      setIsLoading(false);
    }
  }, [row, workspaceKey, selectedEmailBrand]);

  useEffect(() => {
    loadReviewData();
  }, [loadReviewData]);

  const emailIssues = useMemo(
    () => logs.filter((log) => log.source === 'EmailDelivery' && isFailedEmailStatus(log.status)),
    [logs]
  );
  const sheetIssues = useMemo(
    () => sheetJobs.filter((job) => isSheetSyncIssue(job.status)),
    [sheetJobs]
  );
  const status = getLeadStatus(row);
  const rowFailed = status === 'Failed';

  const handleEmailAction = async (log: EmailHistoryLog, action: 'mark-sent' | 'mark-failed' | 'retry') => {
    if (!isNeedsReviewStatus(log.status) || log.source !== 'EmailDelivery') return;

    let body: Record<string, string> = {};
    if (action === 'mark-sent') {
      const providerMessageId = window.prompt('Optional: paste Gmail message ID if you found this email in Sent Mail.');
      body = providerMessageId ? { providerMessageId } : {};
    }
    if (action === 'mark-failed') {
      const reason = window.prompt('Add a short reason for marking this email failed.', 'Manually reviewed and not sent.');
      if (reason === null) return;
      body = { reason };
    }
    if (action === 'retry') {
      const confirmed = window.confirm('Check Gmail Sent Mail first. Retry only if this email was not already sent.');
      if (!confirmed) return;
    }

    setActionId(`${log.id}:${action}`);
    try {
      const res = await apiFetch(`/api/email-deliveries/${encodeURIComponent(log.id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Email review action failed.');
      toast.success(action === 'retry' ? 'Email retry sent.' : 'Email review updated.');
      await loadReviewData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Email review action failed.');
    } finally {
      setActionId(null);
    }
  };

  const retrySheetSync = async (job: SheetSyncJob) => {
    const confirmed = window.confirm('Retry this Google Sheet row update now?');
    if (!confirmed) return;

    setActionId(`sheet:${job.id}`);
    try {
      const res = await apiFetch(`/api/sheet-sync/jobs/${encodeURIComponent(job.id)}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Sheet sync retry failed.');
      toast.success(data.skipped ? 'Sheet row is already synced.' : 'Sheet sync retry completed.');
      await loadReviewData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sheet sync retry failed.');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{row.full_name || 'Unnamed lead'}</p>
            <StatusBadge status={rowFailed ? 'Failed' : status || 'Manual Review'} />
            {isLoading && <Badge variant="outline">Loading</Badge>}
          </div>
          <p className="mt-1 break-all text-sm text-muted-foreground">{row.email || 'No email'}</p>
          <p className="mt-2 text-sm text-muted-foreground">{String(row.Remarks || 'Needs manual review')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onViewDetails}>
          <Eye className="h-4 w-4" />
          Row details
        </Button>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Mail className="h-4 w-4" />
            Failed or unknown emails
          </div>
          {emailIssues.length === 0 ? (
            <EmptyReviewLine icon={<CheckCircle2 className="h-4 w-4" />} text="No email delivery item needs action." />
          ) : (
            <div className="space-y-2">
              {emailIssues.map((log) => {
                const canReview = isNeedsReviewStatus(log.status);
                return (
                  <div key={log.id} className="rounded-md border bg-background p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{formatLogType(log.type)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatStatus(log.status)} | {emailBrandLabel(log.emailBrand || row.__emailBrand || selectedEmailBrand)} | attempts {log.attemptCount || 1}
                        </p>
                      </div>
                      <Badge variant={canReview ? 'outline' : 'destructive'}>{formatStatus(log.status)}</Badge>
                    </div>
                    {log.error && <p className="mt-2 text-xs text-destructive">{log.error}</p>}
                    {log.messageId && <p className="mt-2 break-all text-xs text-muted-foreground">Gmail ID: {log.messageId}</p>}
                    {canReview ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" disabled={actionId !== null} onClick={() => handleEmailAction(log, 'mark-sent')}>
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Mark Sent
                        </Button>
                        <Button type="button" size="sm" variant="outline" disabled={actionId !== null} onClick={() => handleEmailAction(log, 'retry')}>
                          <RotateCcw className="h-3.5 w-3.5" />
                          Retry
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10" disabled={actionId !== null} onClick={() => handleEmailAction(log, 'mark-failed')}>
                          <XCircle className="h-3.5 w-3.5" />
                          Mark Failed
                        </Button>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">This item is handled by automatic retry or needs row correction.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-md border bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <AlertCircle className="h-4 w-4" />
            Sheet update retry items
          </div>
          {sheetIssues.length === 0 ? (
            <EmptyReviewLine icon={<CheckCircle2 className="h-4 w-4" />} text="No sheet sync item needs action." />
          ) : (
            <div className="space-y-2">
              {sheetIssues.map((job) => (
                <div key={job.id} className="rounded-md border bg-background p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">Google Sheet row update</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(job.updatedAt || job.createdAt)} | attempts {job.retryCount}/{job.maxRetries}
                      </p>
                    </div>
                    <Badge variant="outline">{formatSheetSyncStatus(job.status)}</Badge>
                  </div>
                  {job.lastError && <p className="mt-2 text-xs text-destructive">{job.lastError}</p>}
                  {job.nextRetryAt && <p className="mt-2 text-xs text-muted-foreground">Next retry: {formatDateTime(job.nextRetryAt)}</p>}
                  <Button type="button" size="sm" variant="outline" className="mt-3" disabled={actionId !== null} onClick={() => retrySheetSync(job)}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry Sheet Sync
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyReviewLine({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background p-3 text-sm text-muted-foreground">
      {icon}
      <span>{text}</span>
    </div>
  );
}
