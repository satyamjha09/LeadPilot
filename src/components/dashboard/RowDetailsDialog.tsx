import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Clock3, Mail, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import StatusBadge from '@/src/components/dashboard/StatusBadge';
import { getLeadStatus, hasMeetLink } from '@/src/lib/rowUtils';
import { ExcelRow } from '@/src/types';

type EmailHistoryLog = {
  id: string;
  source?: string;
  type: string;
  status: string;
  recipient?: string | null;
  messageId?: string | null;
  error?: string | null;
  sentAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  attemptCount?: number;
};

interface RowDetailsDialogProps {
  row: ExcelRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RowDetailsDialog({ row, open, onOpenChange }: RowDetailsDialogProps) {
  const [logs, setLogs] = useState<EmailHistoryLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [reviewActionId, setReviewActionId] = useState<string | null>(null);

  const loadEmailHistory = useCallback(async () => {
    if (!row) return;
    setIsLoadingLogs(true);
    setHistoryError('');

    try {
      const res = await fetch('/api/leads/email-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ row })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load email history.');
      setLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (err: unknown) {
      setLogs([]);
      setHistoryError(err instanceof Error ? err.message : 'Could not load email history.');
    } finally {
      setIsLoadingLogs(false);
    }
  }, [row]);

  useEffect(() => {
    if (!open || !row) return;
    loadEmailHistory();
  }, [loadEmailHistory, open, row]);

  const handleManualReview = async (log: EmailHistoryLog, action: 'mark-sent' | 'mark-failed' | 'retry') => {
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

    setReviewActionId(`${log.id}:${action}`);
    try {
      const res = await fetch(`/api/email-deliveries/${encodeURIComponent(log.id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      await loadEmailHistory();
      if (!res.ok) throw new Error(data.error || 'Email review action failed.');
      toast.success(action === 'retry' ? 'Email retry sent.' : 'Email review updated.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Email review action failed.');
    } finally {
      setReviewActionId(null);
    }
  };

  const sourceFields = useMemo(() => {
    if (!row) return [];
    const hiddenKeys = new Set(['id', '__originalColumns']);
    const orderedKeys = [
      ...(Array.isArray(row.__originalColumns) ? row.__originalColumns : []),
      ...Object.keys(row)
    ];
    return Array.from(new Set(orderedKeys))
      .filter((key) => !hiddenKeys.has(key))
      .filter((key) => row[key] !== undefined && row[key] !== null && String(row[key]) !== '');
  }, [row]);

  if (!row) return null;

  const status = getLeadStatus(row);
  const meetLink = String(row['Meeting Details'] || '');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b p-5 pr-12">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <SheetTitle className="truncate text-lg">{row.full_name || 'Lead details'}</SheetTitle>
              <SheetDescription className="truncate">
                {row.email || 'No email available'}
              </SheetDescription>
            </div>
            <StatusBadge status={status} />
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-82px)]">
          <div className="space-y-5 p-5">
            <section className="space-y-3">
              <SectionTitle>Meeting</SectionTitle>
              <div className="grid gap-3 rounded-md border bg-card p-3">
                <Detail label="Email" value={row.email} />
                <Detail label="Date of Demo" value={row['Date of Demo']} />
                <Detail label="Time of Demo" value={row['Time of Demo']} />
                <Detail
                  label="Meeting Link"
                  value={
                    hasMeetLink(meetLink) ? (
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto p-0 font-semibold"
                        onClick={() => window.open(meetLink, '_blank', 'noopener,noreferrer')}
                      >
                        Open Google Meet
                      </Button>
                    ) : (
                      '-'
                    )
                  }
                />
                <Detail label="Lead Status" value={row.lead_status} />
                <Detail label="Remarks" value={row.Remarks || '-'} />
              </div>
            </section>

            <section className="space-y-3">
              <SectionTitle>Email History</SectionTitle>
              <div className="rounded-md border bg-card">
                {isLoadingLogs ? (
                  <HistoryEmpty icon={<Clock3 className="h-4 w-4" />} text="Loading email history..." />
                ) : historyError ? (
                  <HistoryEmpty icon={<AlertCircle className="h-4 w-4" />} text={historyError} />
                ) : logs.length === 0 ? (
                  <HistoryEmpty icon={<Mail className="h-4 w-4" />} text="No email history recorded for this lead yet." />
                ) : (
                  <div className="divide-y">
                    {logs.map((log) => {
                      const needsReview = isNeedsReviewStatus(log.status) && log.source === 'EmailDelivery';
                      return (
                      <div key={log.id} className="space-y-2 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {isSentStatus(log.status) ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            ) : needsReview ? (
                              <AlertTriangle className="h-4 w-4 text-amber-600" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-destructive" />
                            )}
                            <span className="font-medium">{formatLogType(log.type)}</span>
                          </div>
                          <Badge
                            variant={isSentStatus(log.status) || needsReview ? 'outline' : 'destructive'}
                            className={needsReview ? 'border-amber-300 bg-amber-50 text-amber-700' : undefined}
                          >
                            {formatStatus(log.status)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(log.sentAt || log.updatedAt || log.createdAt)}
                        </p>
                        {log.recipient && (
                          <p className="break-all text-xs text-muted-foreground">Recipient: {log.recipient}</p>
                        )}
                        {log.messageId && (
                          <p className="break-all text-xs text-muted-foreground">Gmail message ID: {log.messageId}</p>
                        )}
                        {typeof log.attemptCount === 'number' && log.attemptCount > 1 && (
                          <p className="text-xs text-muted-foreground">Attempts: {log.attemptCount}</p>
                        )}
                        {log.source && (
                          <p className="text-xs text-muted-foreground">Source: {formatSource(log.source)}</p>
                        )}
                        {log.error && <p className="text-xs text-destructive">{log.error}</p>}
                        {needsReview && (
                          <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                            <div className="flex gap-2 text-xs text-amber-800">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                              <p>
                                Gmail result is unclear. Check Sent Mail before retrying so the customer does not get a duplicate email.
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => handleManualReview(log, 'mark-sent')}
                                disabled={reviewActionId !== null}
                              >
                                <ShieldCheck className="h-3.5 w-3.5" />
                                Mark sent
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => handleManualReview(log, 'retry')}
                                disabled={reviewActionId !== null}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                Retry
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="border-destructive/30 text-destructive hover:bg-destructive/10"
                                onClick={() => handleManualReview(log, 'mark-failed')}
                                disabled={reviewActionId !== null}
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                Mark failed
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                    })}
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <SectionTitle>Source Fields</SectionTitle>
              <div className="rounded-md border bg-card">
                {sourceFields.map((key, index) => (
                  <div key={key}>
                    <div className="grid grid-cols-3 gap-3 p-3 text-sm">
                      <span className="break-words text-muted-foreground">{key}</span>
                      <span className="col-span-2 break-words font-medium">{String(row[key])}</span>
                    </div>
                    {index < sourceFields.length - 1 && <Separator />}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold">{children}</h3>;
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2 break-words font-medium">{value || '-'}</span>
    </div>
  );
}

function HistoryEmpty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
      {icon}
      <span>{text}</span>
    </div>
  );
}

function formatLogType(type: string) {
  if (type === 'DEMO_SCHEDULED') return 'Meeting invite';
  if (type === 'DEMO_RESCHEDULED') return 'Reschedule email';
  if (type === 'DEMO_DONE') return 'Thank-you email';
  if (type === 'DEMO_DONE_THANK_YOU') return 'Thank-you email';
  if (type === 'NO_RESPONSE') return 'No Response email';
  return type.replace(/_/g, ' ').toLowerCase();
}

function isSentStatus(status: string) {
  return status.toLowerCase() === 'sent';
}

function isNeedsReviewStatus(status: string) {
  return status.toUpperCase() === 'UNKNOWN';
}

function formatStatus(status: string) {
  if (isNeedsReviewStatus(status)) return 'needs review';
  return status.replace(/_/g, ' ').toLowerCase();
}

function formatSource(source: string) {
  if (source === 'EmailDelivery') return 'Delivery log';
  if (source === 'EmailLog') return 'Legacy email log';
  return source;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}
