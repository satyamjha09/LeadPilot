import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Clock3, Eye, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import RowDetailsDialog from '@/src/components/dashboard/RowDetailsDialog';
import {
  formatDateTime,
  formatLogType,
  formatSource,
  formatStatus,
  isNeedsReviewStatus,
  isSentStatus,
  type EmailHistoryLog
} from '@/src/components/dashboard/reviewTypes';
import { ExcelRow } from '@/src/types';
import { emailBrandLabel, type EmailBrandKey } from '@/src/lib/emailBrand';
import type { WorkspaceKey } from '@/src/lib/senderAccount';
import { apiFetch } from '@/src/lib/authClient';

export default function EmailLogsView({
  rows,
  workspaceKey,
  selectedEmailBrand
}: {
  rows: ExcelRow[];
  workspaceKey: WorkspaceKey;
  selectedEmailBrand: EmailBrandKey;
}) {
  const [detailsRow, setDetailsRow] = useState<ExcelRow | null>(null);
  const brandLabel = emailBrandLabel(selectedEmailBrand);

  return (
    <>
      <Card className="tk-premium-card overflow-hidden">
        <CardHeader className="border-b bg-sky-50/45 dark:bg-sky-950/20">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-5 w-5 text-sky-600" />
                Email Logs
              </CardTitle>
              <CardDescription>
                Sent history, retries, Gmail message IDs, and delivery errors for the current workspace.
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
              No email activity has been recorded yet.
            </div>
          ) : (
            rows.map((row) => (
              <div key={row.id}>
                <EmailLogRow
                  row={row}
                  selectedEmailBrand={selectedEmailBrand}
                  brandLabel={brandLabel}
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

function EmailLogRow({
  row,
  selectedEmailBrand,
  brandLabel,
  onViewDetails
}: {
  row: ExcelRow;
  selectedEmailBrand: EmailBrandKey;
  brandLabel: string;
  onViewDetails: () => void;
}) {
  const [logs, setLogs] = useState<EmailHistoryLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const rowBrandLabel = row.__emailBrand ? emailBrandLabel(row.__emailBrand) : brandLabel;

  const loadLogs = useCallback(async () => {
    const businessEmailBrand = row.__emailBrand || selectedEmailBrand;
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/leads/email-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ row, emailBrand: businessEmailBrand })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load email history.');
      setLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load email history.');
      setLogs([]);
    } finally {
      setIsLoading(false);
    }
  }, [row, selectedEmailBrand]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="font-semibold">{row.full_name || 'Unnamed lead'}</p>
          <p className="mt-1 break-all text-sm text-muted-foreground">{row.email || 'No email'}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="outline">Brand: {rowBrandLabel}</Badge>
            <Badge variant="outline">{logs.length} log{logs.length === 1 ? '' : 's'}</Badge>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onViewDetails}>
          <Eye className="h-4 w-4" />
          Row details
        </Button>
      </div>

      <div className="mt-4 rounded-md border">
        {isLoading ? (
          <LogEmpty icon={<Clock3 className="h-4 w-4" />} text="Loading email history..." />
        ) : logs.length === 0 ? (
          <LogEmpty icon={<Mail className="h-4 w-4" />} text="No email history loaded for this row." />
        ) : (
          <div className="divide-y">
            {logs.map((log) => {
              const logBrandLabel = log.emailBrand ? emailBrandLabel(log.emailBrand) : brandLabel;
              return (
                <div key={`${log.source}-${log.id}`} className="grid gap-3 p-3 xl:grid-cols-[1.2fr_1fr_0.8fr_0.9fr_1fr]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {isSentStatus(log.status) ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : isNeedsReviewStatus(log.status) ? (
                        <AlertCircle className="h-4 w-4 text-amber-600" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      )}
                      <p className="truncate text-sm font-semibold">{formatLogType(log.type)}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{formatSource(log.source || 'EmailDelivery')}</p>
                    {log.error && <p className="mt-2 text-xs text-destructive">{log.error}</p>}
                  </div>

                  <LogField label="Recipient" value={log.recipient || row.email || '-'} />
                  <LogField label="Status" value={formatStatus(log.status)} />
                  <LogField label="Brand" value={logBrandLabel} />
                  <div className="min-w-0 space-y-1 text-xs">
                    <LogField label="Gmail message id" value={log.messageId || '-'} />
                    <LogField label="Retry / attempts" value={String(log.attemptCount || 1)} />
                    <LogField label="Time" value={formatDateTime(log.sentAt || log.updatedAt || log.createdAt)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function LogField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 text-xs">
      <p className="font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 break-all text-foreground">{value}</p>
    </div>
  );
}

function LogEmpty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
      {icon}
      <span>{text}</span>
    </div>
  );
}
