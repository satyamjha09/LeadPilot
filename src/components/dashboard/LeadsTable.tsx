import { useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarPlus, CheckCircle2, Copy, Eye, FileText, RotateCw, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import EmptyState from '@/src/components/dashboard/EmptyState';
import LeadStatusSelect from '@/src/components/dashboard/LeadStatusSelect';
import RowDetailsDialog from '@/src/components/dashboard/RowDetailsDialog';
import StatusBadge from '@/src/components/dashboard/StatusBadge';
import { LEAD_STATUS, LeadStatusLabel } from '@/src/lib/leadStatus';
import {
  canMarkDemoOutcome,
  canProcessLead,
  canScheduleNewDemo,
  canStartReschedule,
  getLeadStatus,
  hasMeetLink,
  hasMeetingStarted,
  isActiveDemoRow,
} from '@/src/lib/rowUtils';
import { ExcelRow } from '@/src/types';
import { cn } from '@/lib/utils';

interface LeadsTableProps {
  rows: ExcelRow[];
  filteredRows: ExcelRow[];
  selectedRowIds: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAllVisible: () => void;
  onStatusChangeRequest: (row: ExcelRow, newStatus: LeadStatusLabel, previousStatus: LeadStatusLabel | 'Failed' | '') => void;
  onForceCloseActiveDemo?: (row: ExcelRow, remarks: string) => void;
  onProcessRow?: (row: ExcelRow) => void;
  isProcessing?: boolean;
}

export default function LeadsTable({
  rows,
  filteredRows,
  selectedRowIds,
  onToggleRow,
  onToggleAllVisible,
  onStatusChangeRequest,
  onForceCloseActiveDemo,
  onProcessRow,
  isProcessing = false
}: LeadsTableProps) {
  const [detailsRow, setDetailsRow] = useState<ExcelRow | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    row: ExcelRow;
    status: LeadStatusLabel;
  } | null>(null);
  const [forceCloseAction, setForceCloseAction] = useState<ExcelRow | null>(null);
  const [forceCloseRemarks, setForceCloseRemarks] = useState('');
  const [remarkRow, setRemarkRow] = useState<ExcelRow | null>(null);

  if (rows.length === 0) {
    return <EmptyState />;
  }

  const selectableVisible = filteredRows.filter((row) => canProcessLead(row));
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((row) => selectedRowIds.has(row.id));

  const copyToClipboard = async (value: string, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`);
    }
  };

  const requestStatusAction = (
    row: ExcelRow,
    nextStatus: LeadStatusLabel,
    previousStatus: LeadStatusLabel | 'Failed' | ''
  ) => {
    if (
      (nextStatus === LEAD_STATUS.DEMO_DONE || nextStatus === LEAD_STATUS.NO_RESPONSE) &&
      !canMarkDemoOutcome(row)
    ) {
      toast.error('Attendance actions are available only after the active demo start time.');
      return;
    }

    if (nextStatus === LEAD_STATUS.RESCHEDULE && !canStartReschedule(row)) {
      toast.error('Reschedule requires an active scheduled demo with a Meet link.');
      return;
    }

    if (nextStatus === LEAD_STATUS.DEMO_DONE || nextStatus === LEAD_STATUS.NO_RESPONSE) {
      setConfirmAction({ row, status: nextStatus });
      return;
    }

    onStatusChangeRequest(row, nextStatus, previousStatus);
  };

  const submitConfirmedAction = () => {
    if (!confirmAction) return;
    const previousStatus = getLeadStatus(confirmAction.row);
    onStatusChangeRequest(confirmAction.row, confirmAction.status, previousStatus);
    setConfirmAction(null);
  };

  const submitForceClose = () => {
    if (!forceCloseAction || !onForceCloseActiveDemo) return;
    onForceCloseActiveDemo(forceCloseAction, forceCloseRemarks);
    setForceCloseAction(null);
    setForceCloseRemarks('');
  };

  return (
    <>
      <Card className="tk-premium-card overflow-hidden">
        <CardHeader>
          <CardTitle className="text-lg">Lead Workspace</CardTitle>
          <CardDescription>
            Showing {filteredRows.length} of {rows.length} leads | {selectedRowIds.size} selected
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="w-full whitespace-nowrap">
            <Table className="min-w-[1080px]">
              <TableHeader>
                <TableRow className="sticky top-0 z-20 bg-slate-50/90 hover:bg-slate-50 dark:bg-slate-900/90 dark:hover:bg-slate-900">
                  <TableHead className="w-10 bg-card">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={onToggleAllVisible}
                      aria-label="Select all visible rows"
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Demo Time</TableHead>
                  <TableHead>Meeting Details</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Remark</TableHead>
                  <TableHead className="sticky right-0 z-30 bg-card text-right shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      No leads match your search or filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((row) => {
                    const status = getLeadStatus(row);
                    const displayStatus = status as LeadStatusLabel | 'Failed' | '';
                    const badgeStatus = getDashboardStatus(row, displayStatus);
                    const meetDetails = String(row['Meeting Details'] || '');
                    const selectable = canProcessLead(row);
                    const rowHintClass = getRowHintClass(displayStatus);
                    const activeDemo = isActiveDemoRow(row);
                    const meetingStarted = hasMeetingStarted(row);
                    const canForceClose =
                      !!onForceCloseActiveDemo &&
                      /already has an active demo/i.test(String(row.Remarks || ''));

                    return (
                      <TableRow
                        key={row.id}
                        data-state={selectedRowIds.has(row.id) ? 'selected' : undefined}
                        className={cn('transition-colors hover:bg-sky-50/60 dark:hover:bg-sky-950/20', rowHintClass)}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedRowIds.has(row.id)}
                            disabled={!selectable || isProcessing}
                            onCheckedChange={() => selectable && onToggleRow(row.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{row.full_name || '-'}</TableCell>
                        <TableCell className="max-w-[220px]">
                          <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                            <span className="min-w-0 truncate font-medium text-sky-600 dark:text-sky-400">{row.email || '-'}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="leading-tight">
                            <div className="font-medium">{String(row['Time of Demo'] || '-')}</div>
                            <div className="text-xs text-muted-foreground">{String(row['Date of Demo'] || '-')}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {hasMeetLink(meetDetails) ? (
                            <div className="flex items-center gap-1.5">
                              <IconTooltip label="Open Google Meet">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="Open Google Meet"
                                  className="h-8 w-8 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-950/30"
                                  onClick={() => window.open(meetDetails, '_blank', 'noopener,noreferrer')}
                                >
                                  <GoogleMeetIcon />
                                </Button>
                              </IconTooltip>
                              <IconTooltip label="Copy Meet link">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="Copy Meet link"
                                  className="h-7 w-7"
                                  onClick={() => copyToClipboard(meetDetails, 'Meet link')}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                              </IconTooltip>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-2">
                            <StatusBadge status={badgeStatus} />
                            <LeadStatusSelect
                              value={row.lead_status || ''}
                              disabled={isProcessing}
                              onValueChange={(newStatus) =>
                                requestStatusAction(row, newStatus, status)
                              }
                            />
                            {activeDemo && (
                              <span className="text-xs text-muted-foreground">
                                {meetingStarted ? 'Ready for attendance decision' : 'Attendance actions unlock after start'}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <IconTooltip label="View remark">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="View remark"
                              className="h-8 w-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                              onClick={() => setRemarkRow(row)}
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                          </IconTooltip>
                        </TableCell>
                        <TableCell className="sticky right-0 z-10 bg-inherit text-right shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">
                          <div className="flex justify-end gap-1 bg-inherit">
                            {activeDemo && (
                              <>
                                <IconTooltip label="Reschedule active demo">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Reschedule active demo"
                                    disabled={isProcessing || !canStartReschedule(row)}
                                    onClick={() => onStatusChangeRequest(row, LEAD_STATUS.RESCHEDULE, status)}
                                  >
                                    <RotateCw className="h-4 w-4" />
                                  </Button>
                                </IconTooltip>
                                <IconTooltip label={meetingStarted ? 'Mark demo done' : 'Demo Done unlocks after start'}>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Mark demo done"
                                    disabled={isProcessing || !canMarkDemoOutcome(row)}
                                    onClick={() => setConfirmAction({ row, status: LEAD_STATUS.DEMO_DONE })}
                                  >
                                    <CheckCircle2 className="h-4 w-4" />
                                  </Button>
                                </IconTooltip>
                                <IconTooltip label={meetingStarted ? 'Mark No Response' : 'No Response unlocks after start'}>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Mark No Response"
                                    disabled={isProcessing || !canMarkDemoOutcome(row)}
                                    onClick={() => setConfirmAction({ row, status: LEAD_STATUS.NO_RESPONSE })}
                                  >
                                    <UserX className="h-4 w-4" />
                                  </Button>
                                </IconTooltip>
                              </>
                            )}
                            {canScheduleNewDemo(row) && (
                              <IconTooltip label="Schedule a new demo">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="Schedule a new demo"
                                  disabled={isProcessing}
                                  onClick={() => onStatusChangeRequest(row, LEAD_STATUS.DEMO_SCHEDULED, status)}
                                >
                                  <CalendarPlus className="h-4 w-4" />
                                </Button>
                              </IconTooltip>
                            )}
                            {canForceClose && (
                              <IconTooltip label="Force close previous active demo">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="Force close previous active demo"
                                  disabled={isProcessing}
                                  onClick={() => {
                                    setForceCloseAction(row);
                                    setForceCloseRemarks('Previous active demo force closed by user.');
                                  }}
                                >
                                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                                </Button>
                              </IconTooltip>
                            )}
                            <IconTooltip label="View details">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label="View lead details"
                                onClick={() => setDetailsRow(row)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </IconTooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardContent>
      </Card>

      <RowDetailsDialog
        row={detailsRow}
        open={!!detailsRow}
        onOpenChange={(open) => !open && setDetailsRow(null)}
      />

      <Dialog open={!!remarkRow} onOpenChange={(open) => !open && setRemarkRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remark</DialogTitle>
            <DialogDescription>
              {remarkRow?.full_name || 'Selected lead'} {remarkRow?.email ? `(${remarkRow.email})` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-4 text-sm leading-6 text-foreground">
            {formatRemark(remarkRow?.Remarks)}
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setRemarkRow(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmAction?.status === LEAD_STATUS.DEMO_DONE
                ? 'Mark this demo as completed?'
                : 'Mark this customer as No Response?'}
            </DialogTitle>
            <DialogDescription>
              {confirmAction?.status === LEAD_STATUS.DEMO_DONE
                ? 'This will mark the demo as done, send the thank-you email, close the active meeting, and clear the active meeting data.'
                : 'This will close the active demo, clear the active meeting information, and send the We Missed You email.'}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="font-medium">{confirmAction?.row.full_name || 'Selected lead'}</div>
            <div className="text-muted-foreground">{confirmAction?.row.email || 'No email'}</div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={submitConfirmedAction} disabled={isProcessing}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!forceCloseAction}
        onOpenChange={(open) => {
          if (!open) {
            setForceCloseAction(null);
            setForceCloseRemarks('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Force close previous demo?</DialogTitle>
            <DialogDescription>
              This clears the active demo session for this customer so the lead can be scheduled again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="font-medium">{forceCloseAction?.full_name || 'Selected lead'}</div>
              <div className="text-muted-foreground">{forceCloseAction?.email || 'No email'}</div>
            </div>
            <label className="block text-sm font-medium" htmlFor="force-close-remarks">
              Remark
            </label>
            <textarea
              id="force-close-remarks"
              value={forceCloseRemarks}
              onChange={(event) => setForceCloseRemarks(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setForceCloseAction(null);
                setForceCloseRemarks('');
              }}
            >
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={submitForceClose} disabled={isProcessing}>
              Force close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GoogleMeetIcon() {
  return (
    <span className="relative inline-block h-[18px] w-[22px]" aria-hidden="true">
      <span className="absolute left-[4px] top-0 h-[7px] w-[10px] rounded-tl-[3px] bg-[#ea4335]" />
      <span className="absolute left-[9px] top-0 h-[7px] w-[8px] rounded-tr-[3px] bg-[#fbbc04]" />
      <span className="absolute left-[4px] top-[7px] h-[6px] w-[7px] bg-[#4285f4]" />
      <span className="absolute left-[4px] top-[13px] h-[5px] w-[7px] rounded-bl-[3px] bg-[#1a73e8]" />
      <span className="absolute left-[11px] top-[7px] h-[11px] w-[8px] rounded-br-[3px] bg-[#34a853]" />
      <span
        className="absolute left-[14px] top-[6px] h-[12px] w-[8px] bg-[#00ac47]"
        style={{ clipPath: 'polygon(0 35%, 100% 0, 100% 100%, 0 65%)' }}
      />
      <span
        className="absolute left-[11px] top-[7px] h-[6px] w-[8px] bg-[#00832d]"
        style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 50%)' }}
      />
    </span>
  );
}

function getRowHintClass(status: LeadStatusLabel | 'Failed' | '') {
  if (status === 'Failed') return 'bg-destructive/5 hover:bg-destructive/10';
  if (status === LEAD_STATUS.DEMO_SCHEDULED) {
    return 'bg-emerald-50/50 hover:bg-emerald-50 dark:bg-emerald-950/10 dark:hover:bg-emerald-950/20';
  }
  if (status === LEAD_STATUS.DEMO_DONE) {
    return 'bg-teal-50/50 hover:bg-teal-50 dark:bg-teal-950/10 dark:hover:bg-teal-950/20';
  }
  return '';
}

function getDashboardStatus(row: ExcelRow, status: LeadStatusLabel | 'Failed' | '') {
  const remarks = String(row.Remarks || '');
  const emailStatus = String(row.email_status || row.__emailStatus || '').toLowerCase();
  const sheetStatus = String(row.__sheetSyncStatus || row.sheet_sync_status || '').toLowerCase();

  if (status === 'Failed') return 'Failed';
  if (/manual review|needs review|unknown result|unclear/i.test(remarks) || emailStatus === 'unknown') {
    return 'Manual Review';
  }
  if (/sheet sync pending|sheet update pending|sheet sync retry/i.test(remarks) || /pending|failed/.test(sheetStatus)) {
    return 'Sheet Sync Pending';
  }
  if (/retry pending|email pending|rate limit|429/i.test(remarks) || emailStatus === 'retry_pending') {
    return 'Email Pending';
  }
  return status;
}

function formatRemark(value: unknown) {
  const remark = String(value || '').trim();
  if (!remark) return '-';
  return remark
    .replace(/^lead_status:\s*/i, '')
    .replace(/^remarks:\s*/i, '')
    .replace(/\s+/g, ' ');
}

function IconTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
