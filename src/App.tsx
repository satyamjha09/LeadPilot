import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import AppShell from '@/src/components/layout/AppShell';
import StatsCards from '@/src/components/dashboard/StatsCards';
import ImportPanel from '@/src/components/dashboard/ImportPanel';
import ActionToolbar from '@/src/components/dashboard/ActionToolbar';
import LeadsTable from '@/src/components/dashboard/LeadsTable';
import ProcessingPanel from '@/src/components/dashboard/ProcessingPanel';
import SettingsPanel from '@/src/components/dashboard/SettingsPanel';
import {
  canProcessLead,
  computeStats,
  DashboardView,
  filterRowsByView
} from '@/src/lib/rowUtils';
import { LEAD_STATUS, LeadStatusLabel } from '@/src/lib/leadStatus';
import { getLeadStatus } from '@/src/lib/rowUtils';
import { ExcelRow, AuthStatus, ScheduleSummary, SheetSource } from '@/src/types';

const ROWS_STORAGE_KEY = 'excel-meet-scheduler.rows';
const SELECTED_STORAGE_KEY = 'excel-meet-scheduler.selectedRowIds';
const SOURCE_STORAGE_KEY = 'excel-meet-scheduler.source';

type ProcessPreview = {
  summary: {
    total: number;
    demoScheduled: number;
    demoDone: number;
    statusOnly: number;
    invalid: number;
    skipped: number;
    actionable: number;
  };
  estimatedTime: {
    label: string;
    minMinutes: number;
    maxMinutes: number;
  };
  meetingRecipients: string[];
  thankYouRecipients: string[];
};

const loadStoredRows = (): ExcelRow[] => {
  if (typeof window === 'undefined') return [];
  try {
    const stored = window.localStorage.getItem(ROWS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const loadStoredSelectedIds = () => {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const stored = window.localStorage.getItem(SELECTED_STORAGE_KEY);
    const ids = stored ? JSON.parse(stored) : [];
    return new Set<string>(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set<string>();
  }
};

const loadStoredSource = (): SheetSource => {
  if (typeof window === 'undefined') return { type: 'excel' };
  try {
    const stored = window.localStorage.getItem(SOURCE_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : { type: 'excel' };
    if (parsed?.type === 'google_sheet') {
      return { ...parsed, type: 'google-sheet', headers: parsed.headers || [] };
    }
    return parsed;
  } catch {
    return { type: 'excel' };
  }
};

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [rows, setRows] = useState<ExcelRow[]>(loadStoredRows);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(loadStoredSelectedIds);
  const [source, setSource] = useState<SheetSource>(loadStoredSource);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DashboardView>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('theme') === 'dark';
  });

  const [confirmProcessOpen, setConfirmProcessOpen] = useState(false);
  const [confirmClearAuthOpen, setConfirmClearAuthOpen] = useState(false);
  const [processTargetRows, setProcessTargetRows] = useState<ExcelRow[]>([]);
  const [processPreview, setProcessPreview] = useState<ProcessPreview | null>(null);
  const [isPreflightLoading, setIsPreflightLoading] = useState(false);
  const [statusRevertMap, setStatusRevertMap] = useState<Record<string, LeadStatusLabel | 'Failed' | ''>>({});

  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<{
    current: number;
    total: number;
    success: number;
    failed: number;
    skipped: number;
    currentEmail?: string;
  } | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [lastSummary, setLastSummary] = useState<ScheduleSummary | null>(null);

  const didReconcileStoredRows = useRef(false);
  const importRef = useRef<HTMLDivElement>(null);

  const stats = useMemo(() => computeStats(rows), [rows]);
  const filteredRows = useMemo(
    () => filterRowsByView(rows, activeView, searchQuery, statusFilter),
    [rows, activeView, searchQuery, statusFilter]
  );

  const processTargetFromSelection = useMemo(
    () => rows.filter((row) => selectedRowIds.has(row.id) && canProcessLead(row)),
    [rows, selectedRowIds]
  );

  const sheetRequestMeta = () =>
    source.type === 'google-sheet'
      ? {
          sourceType: 'google-sheet' as const,
          spreadsheetId: source.spreadsheetId,
          sheetName: source.sheetName,
          headers: source.headers
        }
      : { sourceType: 'excel' as const };

  const updateRowInState = (updatedRow: ExcelRow) => {
    setRows((current) => current.map((row) => (row.id === updatedRow.id ? updatedRow : row)));
  };

  const revertRowStatus = (rowId: string, previousStatus: LeadStatusLabel | 'Failed' | '') => {
    setRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              lead_status: previousStatus || LEAD_STATUS.FOLLOW_UP,
              __schedulerStatus: previousStatus === 'Failed' ? 'Failed' : undefined
            }
          : row
      )
    );
  };

  const reconcileRows = async (rowsToReconcile: ExcelRow[]) => {
    if (rowsToReconcile.length === 0) return rowsToReconcile;
    const res = await fetch('/api/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: rowsToReconcile })
    });
    if (!res.ok) return rowsToReconcile;
    const data = await res.json();
    return Array.isArray(data.rows) ? data.rows : rowsToReconcile;
  };

  const fetchAuthStatus = async () => {
    try {
      const res = await fetch('/api/auth/status');
      if (!res.ok) throw new Error('Status server unreachable');
      const data = await res.json();
      setAuthStatus(data);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Auth status failed';
      toast.error(`Failed to load Google auth: ${message}`);
    }
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    window.localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    fetchAuthStatus();
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        fetchAuthStatus();
        toast.success('Google account linked successfully.');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    try {
      if (rows.length > 0) window.localStorage.setItem(ROWS_STORAGE_KEY, JSON.stringify(rows));
      else window.localStorage.removeItem(ROWS_STORAGE_KEY);
    } catch {}
  }, [rows]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SELECTED_STORAGE_KEY, JSON.stringify(Array.from(selectedRowIds)));
    } catch {}
  }, [selectedRowIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(source));
    } catch {}
  }, [source]);

  useEffect(() => {
    if (didReconcileStoredRows.current || rows.length === 0) return;
    didReconcileStoredRows.current = true;
    reconcileRows(rows)
      .then((reconciled) => {
        setRows(reconciled);
        setSelectedRowIds(
          new Set(reconciled.filter((row) => canProcessLead(row)).map((row) => row.id))
        );
      })
      .catch(() => {});
  }, [rows]);

  useEffect(() => {
    if (activeView === 'import') {
      importRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [activeView]);

  const handleDataParsed = async (parsedRows: ExcelRow[]) => {
    const reconciledRows = await reconcileRows(parsedRows);
    setSource({ type: 'excel' });
    setRows(reconciledRows);
    const initiallySelected = new Set<string>();
    reconciledRows.forEach((row) => {
      if (canProcessLead(row)) initiallySelected.add(row.id);
    });
    setSelectedRowIds(initiallySelected);
    setActiveView('dashboard');
    toast.success(`Imported ${reconciledRows.length} rows from Excel`);
  };

  const handleGoogleSheetDataParsed = async (parsedRows: ExcelRow[], sheetSource: SheetSource) => {
    const reconciledRows = await reconcileRows(parsedRows);
    setSource(sheetSource);
    setRows(reconciledRows);
    const initiallySelected = new Set<string>();
    reconciledRows.forEach((row) => {
      if (canProcessLead(row)) initiallySelected.add(row.id);
    });
    setSelectedRowIds(initiallySelected);
    setActiveView('dashboard');
    const sheetName = sheetSource.type === 'google-sheet' ? sheetSource.sheetName : 'sheet';
    toast.success(`Imported ${reconciledRows.length} rows from "${sheetName}"`);
  };

  const openProcessPreflight = async (targetRows: ExcelRow[]) => {
    if (targetRows.length === 0) {
      toast.error('No processable rows selected.');
      return;
    }

    setProcessTargetRows(targetRows);
    setProcessPreview(null);
    setIsPreflightLoading(true);

    try {
      const res = await fetch('/api/process-leads/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: targetRows, ...sheetRequestMeta() })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Process preview failed.');
      }

      setProcessPreview(data);
      setConfirmProcessOpen(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Process preview failed');
      Object.entries(statusRevertMap).forEach(([rowId, previous]) =>
        revertRowStatus(rowId, previous as LeadStatusLabel | 'Failed' | '')
      );
      setStatusRevertMap({});
    } finally {
      setIsPreflightLoading(false);
    }
  };

  const runProcessRows = async () => {
    if (processTargetRows.length === 0) {
      toast.error('No processable rows selected.');
      return;
    }

    if (processPreview && processPreview.summary.actionable === 0) {
      toast.error('No email or status updates are available for these rows.');
      return;
    }

    setConfirmProcessOpen(false);
    setIsProcessing(true);
    setLastSummary(null);
    setProcessingProgress({
      current: 0,
      total: processTargetRows.length,
      success: 0,
      failed: 0,
      skipped: 0
    });
    toast.info('Processing started...');

    try {
      const res = await fetch('/api/process-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: processTargetRows, ...sheetRequestMeta() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lead processing failed.');

      const updatedRows: ExcelRow[] = Array.isArray(data.rows) ? data.rows : [];
      const processSummary = data.summary || {};
      const summary: ScheduleSummary = {
        totalRows: processSummary.total ?? processTargetRows.length,
        total: processSummary.total ?? processTargetRows.length,
        scheduled: processSummary.demoScheduled ?? 0,
        demoScheduled: processSummary.demoScheduled ?? 0,
        demoDone: processSummary.demoDone ?? 0,
        statusOnly: processSummary.statusOnly ?? 0,
        timeConflicts: processSummary.timeConflicts ?? 0,
        failed: processSummary.failed ?? updatedRows.length,
        skipped: processSummary.skipped ?? 0
      };

      const updatedById = new Map(updatedRows.map((row) => [row.id, row]));
      setRows((current) => current.map((row) => updatedById.get(row.id) || row));
      if (source.type === 'google-sheet' && Array.isArray(data.headers)) {
        setSource({ ...source, headers: data.headers });
      }
      setLastSummary(summary);
      setSelectedRowIds(new Set());
      toast.success('Lead processing completed');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Lead processing failed';
      toast.error(message);
      Object.entries(statusRevertMap).forEach(([rowId, previous]) =>
        revertRowStatus(rowId, previous as LeadStatusLabel | 'Failed' | '')
      );
    } finally {
      setIsProcessing(false);
      setProcessingProgress(null);
      setStatusRevertMap({});
      setProcessTargetRows([]);
      setProcessPreview(null);
    }
  };

  const updateStatusOnly = async (
    row: ExcelRow,
    status: LeadStatusLabel,
    previousStatus: LeadStatusLabel | 'Failed' | ''
  ) => {
    try {
      const res = await fetch('/api/lead-status/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          row: { ...row, lead_status: status },
          status,
          ...sheetRequestMeta()
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Status update failed');
      updateRowInState(data.row);
      toast.success('Status updated');
    } catch (err: unknown) {
      revertRowStatus(row.id, previousStatus);
      toast.error(err instanceof Error ? err.message : 'Status update failed');
    }
  };

  const handleStatusChangeRequest = (
    row: ExcelRow,
    newStatus: LeadStatusLabel,
    previousStatus: LeadStatusLabel | 'Failed' | ''
  ) => {
    if (newStatus === previousStatus) return;

    setRows((current) => current.map((r) => (r.id === row.id ? { ...r, lead_status: newStatus } : r)));
    setStatusRevertMap((current) => ({ ...current, [row.id]: previousStatus }));

    if (newStatus === LEAD_STATUS.DEMO_SCHEDULED) {
      openProcessPreflight([{ ...row, lead_status: LEAD_STATUS.DEMO_SCHEDULED }]);
      return;
    }

    if (newStatus === LEAD_STATUS.DEMO_DONE) {
      openProcessPreflight([{ ...row, lead_status: LEAD_STATUS.DEMO_DONE }]);
      return;
    }

    updateStatusOnly(row, newStatus, previousStatus);
  };

  const handleProcessRow = (row: ExcelRow) => {
    setStatusRevertMap({ [row.id]: getLeadStatus(row) });
    openProcessPreflight([row]);
  };

  const handleExportDetails = async () => {
    if (rows.length === 0) return;
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows })
      });
      if (!res.ok) throw new Error('Exporter pipeline failed');
      const data = await res.json();
      const byteCharacters = atob(data.fileData);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = data.filename || 'Excel_Meet_Schedules_Updated.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('Excel file downloaded');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const handleClearAuth = async () => {
    setConfirmClearAuthOpen(false);
    try {
      const res = await fetch('/api/auth/clear', { method: 'POST' });
      if (!res.ok) throw new Error('Server failure rejecting disconnect command.');
      const data = await res.json();
      if (data.status) setAuthStatus(data.status);
      else await fetchAuthStatus();
      toast.success('Google session cleared. Connect again to continue.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Clear session failed');
    }
  };

  const selectAllProcessable = () => {
    const updated = new Set<string>();
    rows.forEach((row) => {
      if (canProcessLead(row)) updated.add(row.id);
    });
    setSelectedRowIds(updated);
  };

  const toggleRow = (id: string) => {
    const updated = new Set(selectedRowIds);
    if (updated.has(id)) updated.delete(id);
    else updated.add(id);
    setSelectedRowIds(updated);
  };

  const toggleAllVisible = () => {
    const visibleSelectable = filteredRows.filter((row) => canProcessLead(row));
    const allSelected = visibleSelectable.every((row) => selectedRowIds.has(row.id));
    const updated = new Set(selectedRowIds);
    visibleSelectable.forEach((row) => {
      if (allSelected) updated.delete(row.id);
      else updated.add(row.id);
    });
    setSelectedRowIds(updated);
  };

  const isAuthActive = !!(authStatus && authStatus.authenticated);
  const showLeadsSection = rows.length > 0 && activeView !== 'settings';
  const showImport = activeView === 'dashboard' || activeView === 'import' || rows.length === 0;

  return (
    <TooltipProvider>
      <AppShell
        authStatus={authStatus}
        onRefreshAuth={fetchAuthStatus}
        onClearAuth={() => setConfirmClearAuthOpen(true)}
        activeView={activeView}
        onNavigate={setActiveView}
        isDark={isDark}
        onToggleTheme={() => setIsDark((prev) => !prev)}
      >
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Meeting Scheduler Dashboard</p>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Import leads from Excel or Google Sheets, create Google Meet links, send Gmail invites, and update your sheet automatically.
          </p>
        </div>

        {activeView === 'settings' ? (
          <SettingsPanel />
        ) : (
          <>
            {rows.length > 0 && ['dashboard', 'all', 'pending', 'scheduled', 'failed', 'import'].includes(activeView) && (
              <StatsCards stats={stats} />
            )}

            {showImport && (
              <div ref={importRef}>
                <ImportPanel
                  onExcelParsed={handleDataParsed}
                  onGoogleSheetParsed={handleGoogleSheetDataParsed}
                  isLoading={isLoadingFile}
                  setIsLoading={setIsLoadingFile}
                  uploadedFileName={uploadedFileName}
                  setUploadedFileName={setUploadedFileName}
                  defaultTab={source.type === 'google-sheet' ? 'google-sheet' : 'excel'}
                />
              </div>
            )}

            <ProcessingPanel
              isProcessing={isProcessing}
              processingProgress={processingProgress}
              lastSummary={lastSummary}
              source={source}
              onExport={source.type === 'excel' ? handleExportDetails : undefined}
            />

            {showLeadsSection && (
              <>
                <ActionToolbar
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  statusFilter={statusFilter}
                  onStatusFilterChange={setStatusFilter}
                  selectedCount={selectedRowIds.size}
                  readyCount={rows.filter((row) => canProcessLead(row)).length}
                  isProcessing={isProcessing}
                  isAuthActive={isAuthActive}
                  source={source}
                  onSelectAllReady={selectAllProcessable}
                  onClearSelection={() => setSelectedRowIds(new Set())}
                  onProcess={() => openProcessPreflight(processTargetFromSelection)}
                  onExport={handleExportDetails}
                />
                <LeadsTable
                  rows={rows}
                  filteredRows={filteredRows}
                  selectedRowIds={selectedRowIds}
                  onToggleRow={toggleRow}
                  onToggleAllVisible={toggleAllVisible}
                  onStatusChangeRequest={handleStatusChangeRequest}
                  onProcessRow={handleProcessRow}
                  isProcessing={isProcessing}
                />
              </>
            )}

            {rows.length === 0 && activeView !== 'import' && activeView !== 'settings' && (
              <LeadsTable
                rows={[]}
                filteredRows={[]}
                selectedRowIds={selectedRowIds}
                onToggleRow={toggleRow}
                onToggleAllVisible={toggleAllVisible}
                onStatusChangeRequest={handleStatusChangeRequest}
                onProcessRow={handleProcessRow}
                isProcessing={isProcessing}
              />
            )}
          </>
        )}
      </AppShell>

      <Dialog
        open={confirmProcessOpen}
        onOpenChange={(open) => {
          setConfirmProcessOpen(open);
          if (!open) {
            Object.entries(statusRevertMap).forEach(([rowId, previous]) =>
              revertRowStatus(rowId, previous as LeadStatusLabel | 'Failed' | '')
            );
            setStatusRevertMap({});
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review processing plan</DialogTitle>
            <DialogDescription>
              Emails will only be sent for Demo Scheduled and Demo Done rows.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            {isPreflightLoading || !processPreview ? (
              <p className="text-muted-foreground">Preparing processing summary...</p>
            ) : (
              <>
                <p>
                  You are about to process <strong>{processPreview.summary.total}</strong> row(s) from{' '}
                  <strong>{source.type === 'google-sheet' ? 'Google Sheet' : 'Excel'}</strong>.
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <PreviewStat label="Demo Scheduled emails" value={processPreview.summary.demoScheduled} />
                  <PreviewStat label="Demo Done thank-you" value={processPreview.summary.demoDone} />
                  <PreviewStat label="Status-only updates" value={processPreview.summary.statusOnly} />
                  <PreviewStat label="Skipped" value={processPreview.summary.skipped} />
                  <PreviewStat label="Invalid" value={processPreview.summary.invalid} />
                  <PreviewStat label="Estimated time" value={processPreview.estimatedTime.label} />
                </div>

                {processPreview.summary.actionable === 0 && (
                  <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                    No email or status updates are available for these rows.
                  </p>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <RecipientList title="Meeting email recipients" recipients={processPreview.meetingRecipients} />
                  <RecipientList title="Thank-you email recipients" recipients={processPreview.thankYouRecipients} />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                Object.entries(statusRevertMap).forEach(([rowId, previous]) =>
                  revertRowStatus(rowId, previous as LeadStatusLabel | 'Failed' | '')
                );
                setConfirmProcessOpen(false);
                setStatusRevertMap({});
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={runProcessRows}
              disabled={
                isProcessing ||
                isPreflightLoading ||
                !processPreview ||
                processPreview.summary.actionable === 0
              }
            >
              Start Processing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmClearAuthOpen} onOpenChange={setConfirmClearAuthOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear session credentials?</DialogTitle>
            <DialogDescription>
              This disconnects the current Google Workspace session. You will need to connect again before scheduling.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmClearAuthOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleClearAuth}>
              Clear Session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

function PreviewStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function RecipientList({ title, recipients }: { title: string; recipients: string[] }) {
  return (
    <div className="rounded-md border p-3">
      <p className="font-medium">{title}</p>
      {recipients.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-muted-foreground">
          {recipients.map((recipient) => (
            <li key={recipient}>{recipient}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted-foreground">None</p>
      )}
    </div>
  );
}
