import { useState, type ReactNode } from 'react';
import { CalendarPlus, Copy, ExternalLink, Eye, Heart } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
  canProcessLead,
  canScheduleDemo,
  canSendThankYou,
  getLeadStatus,
  hasMeetLink,
  isStatusOnly
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
  onProcessRow: (row: ExcelRow) => void;
  isProcessing?: boolean;
}

export default function LeadsTable({
  rows,
  filteredRows,
  selectedRowIds,
  onToggleRow,
  onToggleAllVisible,
  onStatusChangeRequest,
  onProcessRow,
  isProcessing = false
}: LeadsTableProps) {
  const [detailsRow, setDetailsRow] = useState<ExcelRow | null>(null);

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

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Leads</CardTitle>
          <CardDescription>
            Showing {filteredRows.length} of {rows.length} leads | {selectedRowIds.size} selected
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="w-full whitespace-nowrap">
            <Table className="min-w-[1120px]">
              <TableHeader>
                <TableRow className="sticky top-0 z-20 bg-card hover:bg-card">
                  <TableHead className="w-10 bg-card">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={onToggleAllVisible}
                      aria-label="Select all visible rows"
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Meeting Details</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead className="sticky right-0 z-30 bg-card text-right shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                      No leads match your search or filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((row) => {
                    const status = getLeadStatus(row);
                    const displayStatus = (status || LEAD_STATUS.FOLLOW_UP) as LeadStatusLabel | 'Failed';
                    const meetDetails = String(row['Meeting Details'] || '');
                    const selectable = canProcessLead(row);
                    const rowHintClass = getRowHintClass(displayStatus);

                    return (
                      <TableRow
                        key={row.id}
                        data-state={selectedRowIds.has(row.id) ? 'selected' : undefined}
                        className={cn('transition-colors', rowHintClass)}
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
                          <div className="flex items-center gap-1.5">
                            <span className="truncate">{row.email || '-'}</span>
                            {row.email && (
                              <IconTooltip label="Copy email">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="Copy email"
                                  className="h-7 w-7 shrink-0"
                                  onClick={() => copyToClipboard(String(row.email), 'Email')}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                              </IconTooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{String(row['Date of Demo'] || '-')}</TableCell>
                        <TableCell>{String(row['Time of Demo'] || '-')}</TableCell>
                        <TableCell>
                          {hasMeetLink(meetDetails) ? (
                            <div className="flex items-center gap-1.5">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => window.open(meetDetails, '_blank', 'noopener,noreferrer')}
                              >
                                Open Meet
                                <ExternalLink className="h-3 w-3" />
                              </Button>
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
                            <StatusBadge status={displayStatus} />
                            <LeadStatusSelect
                              value={row.lead_status || ''}
                              disabled={isProcessing}
                              onValueChange={(newStatus) =>
                                onStatusChangeRequest(row, newStatus, status)
                              }
                            />
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate" title={row.Remarks}>
                          {row.Remarks || '-'}
                        </TableCell>
                        <TableCell className="sticky right-0 z-10 bg-inherit text-right shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">
                          <div className="flex justify-end gap-1 bg-inherit">
                            {canScheduleDemo(row) && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isProcessing}
                                onClick={() => onProcessRow(row)}
                              >
                                <CalendarPlus className="h-3.5 w-3.5" />
                                Schedule Demo
                              </Button>
                            )}
                            {canSendThankYou(row) && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isProcessing}
                                onClick={() => onProcessRow(row)}
                              >
                                <Heart className="h-3.5 w-3.5" />
                                Thank You
                              </Button>
                            )}
                            {isStatusOnly(row) && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isProcessing}
                                onClick={() => onProcessRow(row)}
                              >
                                Update Status
                              </Button>
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
    </>
  );
}

function getRowHintClass(status: LeadStatusLabel | 'Failed' | '') {
  if (status === 'Failed') return 'bg-destructive/5 hover:bg-destructive/10';
  if (status === LEAD_STATUS.DEMO_SCHEDULED) {
    return 'bg-orange-50/60 hover:bg-orange-50 dark:bg-orange-950/10 dark:hover:bg-orange-950/20';
  }
  if (status === LEAD_STATUS.DEMO_DONE) {
    return 'bg-emerald-50/60 hover:bg-emerald-50 dark:bg-emerald-950/10 dark:hover:bg-emerald-950/20';
  }
  return '';
}

function IconTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
