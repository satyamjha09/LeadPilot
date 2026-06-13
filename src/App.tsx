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
import { AlertTriangle, CheckCircle2, Clock3, Mail, Send, Users } from 'lucide-react';
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
const AUTOMATION_STEPS = ['Validating lead', 'Creating calendar', 'Sending email', 'Updating sheet', 'Done'];

type ProcessPreview = {
  summary: {
    total: number;
    demoScheduled: number;
    reschedule: number;
    demoDone: number;
    noResponse: number;
    statusOnly: number;
    invalid: number;
    skipped: number;
    timeConflicts: number;
    actionable: number;
  };
  estimatedTime: {
    label: string;
    minMinutes: number;
    maxMinutes: number;
  };
  meetingRecipients: string[];
  thankYouRecipients: string[];
  noResponseRecipients: string[];
};

type ProcessingProgress = {
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
  const isSyncingRef = useRef(false);
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null);
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
    setSource(sheetSource);
    setRows(parsedRows);
    const initiallySelected = new Set<string>();
    parsedRows.forEach((row) => {
      if (canProcessLead(row)) initiallySelected.add(row.id);
    });
    setSelectedRowIds(initiallySelected);
    setActiveView('dashboard');
    const sheetName = sheetSource.type === 'google-sheet' ? sheetSource.sheetName : 'sheet';
    toast.success(`Imported ${parsedRows.length} rows from "${sheetName}"`);
  };

  const applyProcessSummary = (rawSummary: any, fallbackTotal: number): ScheduleSummary => ({
    totalRows: rawSummary?.total ?? fallbackTotal,
    total: rawSummary?.total ?? fallbackTotal,
    scheduled: rawSummary?.demoScheduled ?? 0,
    demoScheduled: rawSummary?.demoScheduled ?? 0,
    reschedule: rawSummary?.reschedule ?? 0,
    demoDone: rawSummary?.demoDone ?? 0,
    noResponse: rawSummary?.noResponse ?? 0,
    statusOnly: rawSummary?.statusOnly ?? 0,
    timeConflicts: rawSummary?.timeConflicts ?? 0,
    failed: rawSummary?.failed ?? rawSummary?.invalid ?? 0,
    skipped: rawSummary?.skipped ?? 0
  });

  const syncGoogleSheet = async (showToast = false) => {
    if (source.type !== 'google-sheet' || isSyncingRef.current) return;
    isSyncingRef.current = true;
    setIsProcessing(true);
    setProcessingProgress(null);
    try {
      const res = await fetch('/api/sheets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheetId: source.spreadsheetId,
          sheetName: source.sheetName,
          headers: source.headers
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      const updatedRows = Array.isArray(data.rows) ? data.rows : [];
      setRows(updatedRows);
      if (Array.isArray(data.headers)) setSource({ ...source, headers: data.headers });
      setLastSummary(applyProcessSummary(data.summary, updatedRows.length));
      setSelectedRowIds(new Set(updatedRows.filter((row) => canProcessLead(row)).map((row) => row.id)));
      if (showToast) toast.success(data.skippedDueToLock ? 'Sync already running' : 'Google Sheet refreshed');
    } catch (err: unknown) {
      if (showToast) toast.error(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setIsProcessing(false);
      isSyncingRef.current = false;
    }
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
    const firstRow = processTargetRows[0];
    setProcessingProgress({
      current: Math.min(1, processTargetRows.length),
      total: processTargetRows.length,
      success: 0,
      failed: 0,
      skipped: 0,
      currentName: String(firstRow?.full_name || 'Preparing batch'),
      currentEmail: firstRow?.email ? String(firstRow.email) : undefined,
      currentStep: AUTOMATION_STEPS[0],
      stepIndex: 0,
      steps: AUTOMATION_STEPS
    });
    toast.info('Processing started...');
    let tick = 0;
    const progressTimer = window.setInterval(() => {
      tick += 1;
      setProcessingProgress((current) => {
        if (!current) return current;
        const rowIndex = Math.min(processTargetRows.length - 1, Math.floor(tick / AUTOMATION_STEPS.length));
        const stepIndex = tick % AUTOMATION_STEPS.length;
        const row = processTargetRows[rowIndex];
        const simulatedDone = stepIndex === AUTOMATION_STEPS.length - 1 ? rowIndex + 1 : rowIndex;
        return {
          ...current,
          current: Math.min(processTargetRows.length, rowIndex + 1),
          currentName: String(row?.full_name || 'Processing lead'),
          currentEmail: row?.email ? String(row.email) : undefined,
          currentStep: AUTOMATION_STEPS[stepIndex],
          stepIndex,
          success: Math.min(processTargetRows.length, simulatedDone)
        };
      });
    }, 1200);

    try {
      const res = await fetch('/api/process-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: processTargetRows, ...sheetRequestMeta() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lead processing failed.');

      const updatedRows: ExcelRow[] = Array.isArray(data.rows) ? data.rows : [];
      const summary = applyProcessSummary(data.summary, processTargetRows.length);

      const updatedById = new Map(updatedRows.map((row) => [row.id, row]));
      setRows((current) => current.map((row) => updatedById.get(row.id) || row));
      if (source.type === 'google-sheet' && Array.isArray(data.headers)) {
        setSource({ ...source, headers: data.headers });
      }
      setLastSummary(summary);
      setSelectedRowIds(new Set());
      if (data.sheetSyncError) {
        toast.warning(`Lead processing completed, but Sheet update failed: ${data.sheetSyncError}`);
      } else {
        toast.success('Lead processing completed');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Lead processing failed';
      toast.error(message);
      Object.entries(statusRevertMap).forEach(([rowId, previous]) =>
        revertRowStatus(rowId, previous as LeadStatusLabel | 'Failed' | '')
      );
    } finally {
      window.clearInterval(progressTimer);
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

  const handleForceCloseActiveDemo = async (row: ExcelRow, remarks: string) => {
    setIsProcessing(true);
    try {
      const res = await fetch('/api/active-demo/force-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          row,
          remarks,
          ...sheetRequestMeta()
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Force close failed');
      updateRowInState(data.row);
      setSelectedRowIds((current) => {
        const next = new Set(current);
        if (canProcessLead(data.row)) next.add(data.row.id);
        return next;
      });
      toast.success('Previous active demo closed. You can schedule again.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Force close failed');
    } finally {
      setIsProcessing(false);
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

    if (
      newStatus === LEAD_STATUS.DEMO_DONE ||
      newStatus === LEAD_STATUS.NO_RESPONSE ||
      newStatus === LEAD_STATUS.RESCHEDULE
    ) {
      openProcessPreflight([{ ...row, lead_status: newStatus }]);
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

  const clearWorkspace = () => {
    const confirmed = window.confirm('Clear imported rows from this browser? This will not delete Google Sheet or database data.');
    if (!confirmed) return;

    setRows([]);
    setSelectedRowIds(new Set());
    setSource({ type: 'excel' });
    setUploadedFileName(null);
    setSearchQuery('');
    setStatusFilter('all');
    setLastSummary(null);
    setProcessingProgress(null);
    setProcessTargetRows([]);
    setProcessPreview(null);
    setStatusRevertMap({});
    setActiveView('dashboard');

    try {
      window.localStorage.removeItem(ROWS_STORAGE_KEY);
      window.localStorage.removeItem(SELECTED_STORAGE_KEY);
      window.localStorage.removeItem(SOURCE_STORAGE_KEY);
    } catch {}

    toast.success('Browser workspace cleared. Import a fresh sheet to test again.');
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
  const showLeadsSection = rows.length > 0 && activeView !== 'settings' && activeView !== 'import';
  const showImport = activeView === 'dashboard' || activeView === 'import' || rows.length === 0;
  const viewCopy = getViewCopy(activeView);

  return (
    <TooltipProvider>
      <AppShell
        authStatus={authStatus}
        onRefreshAuth={fetchAuthStatus}
        onClearAuth={() => setConfirmClearAuthOpen(true)}
        source={source}
        onSyncNow={source.type === 'google-sheet' ? () => syncGoogleSheet(true) : undefined}
        isSyncing={isProcessing}
        activeView={activeView}
        onNavigate={setActiveView}
        isDark={isDark}
        onToggleTheme={() => setIsDark((prev) => !prev)}
      >
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">{viewCopy.title}</p>
          <p className="max-w-3xl text-sm text-muted-foreground">{viewCopy.description}</p>
        </div>

        {activeView === 'settings' ? (
          <SettingsPanel />
        ) : (
          <>
            {rows.length > 0 && activeView !== 'import' && (
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
                  onClearWorkspace={clearWorkspace}
                  onProcess={() => openProcessPreflight(processTargetFromSelection)}
                  onSyncNow={source.type === 'google-sheet' ? () => syncGoogleSheet(true) : undefined}
                  onExport={handleExportDetails}
                />
                <LeadsTable
                  rows={rows}
                  filteredRows={filteredRows}
                  selectedRowIds={selectedRowIds}
                  onToggleRow={toggleRow}
                  onToggleAllVisible={toggleAllVisible}
                  onStatusChangeRequest={handleStatusChangeRequest}
                  onForceCloseActiveDemo={handleForceCloseActiveDemo}
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
                onForceCloseActiveDemo={handleForceCloseActiveDemo}
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
        <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b bg-muted/30 px-5 py-4 pr-12">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ClipboardCheckIcon />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg">Review processing plan</DialogTitle>
                <DialogDescription className="mt-1">
                  Confirm email and sheet updates before the workflow starts.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[calc(88vh-9.5rem)] overflow-y-auto px-5 py-4 text-sm">
            {isPreflightLoading || !processPreview ? (
              <div className="flex min-h-48 items-center justify-center rounded-lg border bg-card text-muted-foreground">
                Preparing processing summary...
              </div>
            ) : (
              <div className="space-y-5">
                <div className="tk-hover-card rounded-lg border bg-card p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Processing source</p>
                      <p className="mt-1 text-base font-semibold">
                        {processPreview.summary.total} row(s) from {source.type === 'google-sheet' ? 'Google Sheet' : 'Excel'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                      <Clock3 className="h-4 w-4" />
                      Estimated time: <span className="font-medium text-foreground">{processPreview.estimatedTime.label}</span>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <PreviewStat icon={<Mail className="h-4 w-4" />} label="Scheduled emails" value={processPreview.summary.demoScheduled} tone="blue" />
                  <PreviewStat icon={<Send className="h-4 w-4" />} label="Reschedule emails" value={processPreview.summary.reschedule} tone="cyan" />
                  <PreviewStat icon={<CheckCircle2 className="h-4 w-4" />} label="Thank-you emails" value={processPreview.summary.demoDone} tone="green" />
                  <PreviewStat icon={<Users className="h-4 w-4" />} label="No Response emails" value={processPreview.summary.noResponse ?? 0} tone="amber" />
                  <PreviewStat label="Status-only updates" value={processPreview.summary.statusOnly} />
                  <PreviewStat label="Skipped" value={processPreview.summary.skipped} />
                  <PreviewStat label="Invalid" value={processPreview.summary.invalid} tone="red" />
                  <PreviewStat label="Time conflicts" value={processPreview.summary.timeConflicts} tone="red" />
                </div>

                {processPreview.summary.actionable === 0 && (
                  <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>No email or status updates are available for these rows.</p>
                  </div>
                )}

                <div className="grid gap-3 lg:grid-cols-3">
                  <RecipientList title="Meeting email recipients" recipients={processPreview.meetingRecipients} />
                  <RecipientList title="Thank-you email recipients" recipients={processPreview.thankYouRecipients} />
                  <RecipientList title="No Response email recipients" recipients={processPreview.noResponseRecipients ?? []} />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mx-0 mb-0 rounded-none px-5 py-4">
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

function PreviewStat({
  label,
  value,
  icon,
  tone = 'neutral'
}: {
  label: string;
  value: number | string;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'blue' | 'cyan' | 'green' | 'amber' | 'red';
}) {
  const toneClass = {
    neutral: 'bg-muted text-muted-foreground',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
    cyan: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
  }[tone];

  return (
    <div className="tk-hover-card min-w-0 rounded-lg border bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
        {icon && <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${toneClass}`}>{icon}</div>}
      </div>
      <div className="mt-2 truncate text-xl font-semibold tracking-normal">{value}</div>
    </div>
  );
}

function RecipientList({ title, recipients }: { title: string; recipients: string[] }) {
  return (
    <div className="tk-hover-card min-w-0 rounded-lg border bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate font-medium">{title}</p>
        <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{recipients.length}</span>
      </div>
      {recipients.length > 0 ? (
        <ul className="mt-3 space-y-1 text-muted-foreground">
          {recipients.map((recipient) => (
            <li key={recipient} className="truncate rounded-md bg-muted/50 px-2 py-1 text-xs" title={recipient}>
              {recipient}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-md bg-muted/40 px-2 py-2 text-xs text-muted-foreground">None</p>
      )}
    </div>
  );
}

function getViewCopy(view: DashboardView) {
  const copy: Record<DashboardView, { title: string; description: string }> = {
    dashboard: {
      title: 'Dashboard',
      description: 'Import leads, review workload, and run demo scheduling automations from one place.'
    },
    leads: {
      title: 'Leads',
      description: 'Manage every lead, meeting slot, status badge, remark, and row-level action.'
    },
    automations: {
      title: 'Automations',
      description: 'Process selected leads through validation, calendar creation, email sending, and sheet updates.'
    },
    'manual-review': {
      title: 'Manual Review',
      description: 'Resolve unclear email results, active-demo conflicts, and rows that need a human decision.'
    },
    'email-logs': {
      title: 'Email Logs',
      description: 'Inspect leads with Gmail activity, retries, thank-you emails, no-response emails, and delivery state.'
    },
    import: {
      title: 'Import Leads',
      description: 'Bring in leads from Excel or Google Sheets before running automation.'
    },
    all: {
      title: 'All Leads',
      description: 'View every imported lead in the current workspace.'
    },
    pending: {
      title: 'Pending Automation',
      description: 'Rows that are ready for scheduling, follow-up email, or status processing.'
    },
    scheduled: {
      title: 'Scheduled Demos',
      description: 'Active demos with scheduled meeting slots.'
    },
    failed: {
      title: 'Failed Rows',
      description: 'Rows that failed automation and need correction.'
    },
    settings: {
      title: 'Settings',
      description: 'Manage admin tools, reminders, and test-data controls.'
    }
  };
  return copy[view] || copy.dashboard;
}

function ClipboardCheckIcon() {
  return <CheckCircle2 className="h-5 w-5" />;
}
