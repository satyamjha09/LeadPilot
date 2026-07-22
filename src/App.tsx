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
import DashboardOverview from '@/src/components/dashboard/DashboardOverview';
import ActivityView from '@/src/components/dashboard/ActivityView';
import EmailLogsView from '@/src/components/dashboard/EmailLogsView';
import ImportPanel from '@/src/components/dashboard/ImportPanel';
import ActionToolbar from '@/src/components/dashboard/ActionToolbar';
import LeadsTable from '@/src/components/dashboard/LeadsTable';
import ManualReviewView from '@/src/components/dashboard/ManualReviewView';
import ProcessingPanel from '@/src/components/dashboard/ProcessingPanel';
import SettingsPanel from '@/src/components/dashboard/SettingsPanel';
import {
  canProcessLead,
  computeStats,
  DashboardView,
  filterRowsByView,
  hasEmailActivity,
  needsManualReview
} from '@/src/lib/rowUtils';
import {
  loadStoredRows,
  loadStoredSelectedIds,
  loadStoredSource,
  removeStoredWorkspace,
  workspaceStorageKey
} from '@/src/lib/workspaceStorage';
import { dashboardScopeMatches, type DashboardRequestScope } from '@/src/lib/dashboardScope';
import { LEAD_STATUS, LeadStatusLabel } from '@/src/lib/leadStatus';
import { getLeadStatus } from '@/src/lib/rowUtils';
import {
  ExcelRow,
  AuthStatus,
  DashboardActivityEvent,
  DashboardHealthSummary,
  DashboardTrendPoint,
  NotificationCounts,
  ScheduleSummary,
  SheetSource,
  SourceSelectionScope
} from '@/src/types';
import { emailBrandLabel, type EmailBrandKey } from '@/src/lib/emailBrand';
import {
  SENDER_ACCOUNT_KEYS,
  parseSenderAccountKey,
  senderAccountEmail,
  senderAccountLabel,
  type SenderAccountKey,
  type WorkspaceKey
} from '@/src/lib/senderAccount';
import { cn } from '@/lib/utils';

const LEGACY_EMAIL_BRAND_STORAGE_KEY = 'excel-meet-scheduler.emailBrand';
const WORKSPACE_KEY_STORAGE = 'leadpilot.workspaceKey';
const SENDER_ACCOUNT_STORAGE = 'leadpilot.senderAccountKey';
const EMAIL_BRAND_STORAGE_KEY = 'leadpilot.emailBrandKey';
const EMAIL_BRANDS: Array<{ key: EmailBrandKey; label: string; description: string }> = [
  { key: 'tallykonnect', label: emailBrandLabel('tallykonnect'), description: 'Use TallyKonnect logo, website, and footer.' },
  { key: 'anywheretally', label: emailBrandLabel('anywheretally'), description: 'Use AnyWhereTally logo, website, and footer.' }
];

type ProcessPreview = {
  emailBrand: EmailBrandKey;
  workspaceKey?: WorkspaceKey;
  senderAccountKey?: SenderAccountKey;
  emailBrandKey?: EmailBrandKey;
  sourceId?: string;
  sourceTabId?: string;
  sourceSnapshotId?: string;
  sourceDisplayName?: string;
  sourceTabName?: string;
  sourceScope?: Partial<SourceSelectionScope>;
  lockedSenderAccountKey?: SenderAccountKey;
  lockedSenderAccountKeys?: SenderAccountKey[];
  lockedEmailBrand?: EmailBrandKey;
  lockedBrands?: EmailBrandKey[];
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

type ProcessLeadJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

type ProcessLeadJobResponse = {
  jobId: string;
  status: ProcessLeadJobStatus;
  progress?: {
    total: number;
    processed: number;
    success: number;
    failed: number;
    skipped: number;
    currentName?: string;
    currentEmail?: string;
  };
  rows?: ExcelRow[];
  summary?: ScheduleSummary;
  headers?: string[];
  sourceId?: string;
  sourceTabId?: string;
  sourceSnapshotId?: string;
  sourceScope?: Partial<SourceSelectionScope>;
  sheetSyncError?: string;
  error?: string;
};

type ProcessingProgress = {
  current: number;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  isIndeterminate?: boolean;
  statusLabel?: string;
  currentEmail?: string;
  currentName?: string;
  currentStep?: string;
  stepIndex?: number;
  steps?: string[];
};

type WorkspaceRequestKey =
  | 'excel-preview'
  | 'google-sheet-import'
  | 'google-sheet-sync'
  | 'process-preview'
  | 'lead-processing'
  | 'process-polling'
  | 'reconcile';

const loadStoredEmailBrand = (): EmailBrandKey => {
  if (typeof window === 'undefined') return 'tallykonnect';
  return (window.localStorage.getItem(EMAIL_BRAND_STORAGE_KEY) || window.localStorage.getItem(LEGACY_EMAIL_BRAND_STORAGE_KEY)) === 'anywheretally'
    ? 'anywheretally'
    : 'tallykonnect';
};

const loadStoredWorkspaceKey = (): WorkspaceKey => {
  if (typeof window === 'undefined') return 'tallykonnect';
  return window.localStorage.getItem(WORKSPACE_KEY_STORAGE) === 'anywheretally'
    ? 'anywheretally'
    : loadStoredEmailBrand();
};

const loadStoredSenderAccountKey = (): SenderAccountKey => {
  if (typeof window === 'undefined') return 'tallykonnect-google';
  try {
    return parseSenderAccountKey(window.localStorage.getItem(SENDER_ACCOUNT_STORAGE) || loadStoredEmailBrand());
  } catch {
    return 'tallykonnect-google';
  }
};

const isAbortError = (err: unknown) =>
  err instanceof DOMException
    ? err.name === 'AbortError'
    : err instanceof Error && err.name === 'AbortError';

const abortableDelay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Request aborted', 'AbortError'));
      return;
    }

    let timeoutId = 0;
    const onAbort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException('Request aborted', 'AbortError'));
    };

    timeoutId = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal.addEventListener('abort', onAbort, { once: true });
  });

const getLockedBrandsForRows = (rows: ExcelRow[]) =>
  Array.from(
    new Set(
      rows
        .map((row) => row.__emailBrand)
        .filter((brand): brand is EmailBrandKey => brand === 'tallykonnect' || brand === 'anywheretally')
    )
  );

const getLockedSenderAccountsForRows = (rows: ExcelRow[]) =>
  Array.from(
    new Set(
      rows
        .map((row) => row.__senderAccountKey)
        .filter((sender): sender is SenderAccountKey =>
          sender === 'tallykonnect-google' || sender === 'anywheretally-google'
        )
    )
  );

const senderStatusKey = (status: AuthStatus | null | undefined): SenderAccountKey | undefined => {
  const key = status?.senderAccountKey || status?.key || status?.brand;
  try {
    return parseSenderAccountKey(key);
  } catch {
    return undefined;
  }
};

export default function App() {
  const initialWorkspaceKey = loadStoredWorkspaceKey();
  const initialSenderAccountKey = loadStoredSenderAccountKey();
  const initialEmailBrand = loadStoredEmailBrand();
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [isAuthStatusLoading, setIsAuthStatusLoading] = useState(true);
  const [workspaceKey, setWorkspaceKey] = useState<WorkspaceKey>(initialWorkspaceKey);
  const [selectedSenderAccountKey, setSelectedSenderAccountKey] = useState<SenderAccountKey>(initialSenderAccountKey);
  const [selectedEmailBrandKey, setSelectedEmailBrandKey] = useState<EmailBrandKey>(initialEmailBrand);
  const selectedEmailBrand = selectedEmailBrandKey;
  const setSelectedEmailBrand = setSelectedEmailBrandKey;
  const workspaceBrand = workspaceKey;
  const setWorkspaceBrand = setWorkspaceKey;
  const [rows, setRows] = useState<ExcelRow[]>(() => loadStoredRows(initialWorkspaceKey));
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => loadStoredSelectedIds(initialWorkspaceKey));
  const [source, setSource] = useState<SheetSource>(() => loadStoredSource(initialWorkspaceKey));
  const [selectedSourceScope, setSelectedSourceScope] = useState<SourceSelectionScope | null>(null);
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
  const [processQueueEnabled, setProcessQueueEnabled] = useState(false);
  const [isPreflightLoading, setIsPreflightLoading] = useState(false);
  const [statusRevertMap, setStatusRevertMap] = useState<Record<string, LeadStatusLabel | 'Failed' | ''>>({});

  const [isProcessing, setIsProcessing] = useState(false);
  const isSyncingRef = useRef(false);
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [lastSummary, setLastSummary] = useState<ScheduleSummary | null>(null);
  const [dashboardTrendData, setDashboardTrendData] = useState<DashboardTrendPoint[]>([]);
  const [dashboardActivityEvents, setDashboardActivityEvents] = useState<DashboardActivityEvent[]>([]);
  const [dashboardHealthSummary, setDashboardHealthSummary] = useState<DashboardHealthSummary | null>(null);

  const didReconcileStoredRows = useRef(false);
  const importRef = useRef<HTMLDivElement>(null);
  const selectedEmailBrandRef = useRef(selectedEmailBrand);
  const selectedSenderAccountKeyRef = useRef(selectedSenderAccountKey);
  const selectedSourceScopeRef = useRef<SourceSelectionScope | null>(selectedSourceScope);
  const workspaceKeyRef = useRef(workspaceKey);
  const workspaceGenerationRef = useRef(0);
  const dashboardRequestGenerationRef = useRef(0);
  const dashboardRequestControllerRef = useRef<AbortController | null>(null);
  const workspaceRequestControllersRef = useRef<Record<WorkspaceRequestKey, AbortController | null>>({
    'excel-preview': null,
    'google-sheet-import': null,
    'google-sheet-sync': null,
    'process-preview': null,
    'lead-processing': null,
    'process-polling': null,
    reconcile: null
  });

  const getWorkspaceGeneration = () => workspaceGenerationRef.current;
  const isCurrentWorkspace = (generation: number) => generation === workspaceGenerationRef.current;
  const createDashboardScope = (): DashboardRequestScope => ({
    workspaceKey,
    emailBrand: selectedEmailBrand,
    generation: ++dashboardRequestGenerationRef.current
  });
  const isCurrentDashboardScope = (scope: DashboardRequestScope) =>
    dashboardScopeMatches(scope, {
      workspaceKey: workspaceKeyRef.current,
      emailBrand: selectedEmailBrandRef.current,
      generation: dashboardRequestGenerationRef.current,
      senderAccountKey: selectedSenderAccountKeyRef.current
    });
  const createWorkspaceRequestSignal = (key: WorkspaceRequestKey) => {
    workspaceRequestControllersRef.current[key]?.abort();
    const controller = new AbortController();
    workspaceRequestControllersRef.current[key] = controller;
    return controller.signal;
  };
  const clearWorkspaceRequestSignal = (key: WorkspaceRequestKey, signal: AbortSignal) => {
    if (workspaceRequestControllersRef.current[key]?.signal === signal) {
      workspaceRequestControllersRef.current[key] = null;
    }
  };
  const abortWorkspaceRequests = () => {
    (Object.keys(workspaceRequestControllersRef.current) as WorkspaceRequestKey[]).forEach((key) => {
      workspaceRequestControllersRef.current[key]?.abort();
      workspaceRequestControllersRef.current[key] = null;
    });
  };
  const abortDashboardRequests = () => {
    dashboardRequestControllerRef.current?.abort();
    dashboardRequestControllerRef.current = null;
    dashboardRequestGenerationRef.current += 1;
  };

  const resetTransientWorkspaceUi = () => {
    isSyncingRef.current = false;
    setUploadedFileName(null);
    setSearchQuery('');
    setStatusFilter('all');
    setLastSummary(null);
    setDashboardTrendData([]);
    setDashboardActivityEvents([]);
    setDashboardHealthSummary(null);
    setProcessingProgress(null);
    setProcessTargetRows([]);
    setProcessPreview(null);
    setSelectedSourceScope(null);
    setStatusRevertMap({});
    setIsProcessing(false);
    setIsLoadingFile(false);
    setIsPreflightLoading(false);
    setConfirmProcessOpen(false);
  };

  const loadWorkspace = (nextWorkspaceKey: WorkspaceKey) => {
    workspaceGenerationRef.current += 1;
    abortWorkspaceRequests();
    abortDashboardRequests();
    const storedRows = loadStoredRows(nextWorkspaceKey);
    setWorkspaceBrand(nextWorkspaceKey);
    setRows(storedRows);
    setSelectedRowIds(loadStoredSelectedIds(nextWorkspaceKey));
    setSource(loadStoredSource(nextWorkspaceKey));
    didReconcileStoredRows.current = false;
    resetTransientWorkspaceUi();
    setActiveView(storedRows.length > 0 ? 'dashboard' : 'leads');
  };

  const stats = useMemo(() => computeStats(rows), [rows]);
  const notificationCounts = useMemo<NotificationCounts>(
    () => ({
      manualReview: rows.filter((row) => needsManualReview(row)).length,
      emailLogs: rows.filter((row) => hasEmailActivity(row)).length
    }),
    [rows]
  );
  const filteredRows = useMemo(
    () => filterRowsByView(rows, activeView, searchQuery, statusFilter),
    [rows, activeView, searchQuery, statusFilter]
  );
  const manualReviewRows = useMemo(() => rows.filter((row) => needsManualReview(row)), [rows]);
  const emailLogRows = useMemo(() => rows.filter((row) => hasEmailActivity(row)), [rows]);

  const processTargetFromSelection = useMemo(
    () => rows.filter((row) => selectedRowIds.has(row.id) && canProcessLead(row)),
    [rows, selectedRowIds]
  );

  const previewSummary = processPreview?.summary;
  const previewActionable = previewSummary?.actionable ?? 0;
  const processLockedBrands = useMemo(() => getLockedBrandsForRows(processTargetRows), [processTargetRows]);
  const processLockedSenderAccounts = useMemo(
    () => getLockedSenderAccountsForRows(processTargetRows),
    [processTargetRows]
  );
  const processLockedSenderAccountKey =
    processPreview?.lockedSenderAccountKey ||
    (processPreview?.lockedSenderAccountKeys?.length === 1 ? processPreview.lockedSenderAccountKeys[0] : undefined) ||
    (processLockedSenderAccounts.length === 1 ? processLockedSenderAccounts[0] : undefined);
  const hasMixedProcessSenders =
    processLockedSenderAccounts.length > 1 || (processPreview?.lockedSenderAccountKeys?.length || 0) > 1;
  const hasMixedProcessBrands = processLockedBrands.length > 1 || (processPreview?.lockedBrands?.length || 0) > 1;
  const previewSelectionMatches =
    !!processPreview &&
    (processPreview.senderAccountKey || processPreview.emailBrand) === selectedSenderAccountKey &&
    (processPreview.emailBrandKey || processPreview.emailBrand) === selectedEmailBrand &&
    selectedSourceScopeMatches(processPreview.sourceScope || processPreview);
  const authMatchesSelection =
    !isAuthStatusLoading &&
    !!authStatus?.authenticated &&
    senderStatusKey(authStatus) === selectedSenderAccountKey;
  const canConfirmProcess =
    !isProcessing &&
    !isPreflightLoading &&
    !!processPreview &&
    previewActionable > 0 &&
    !hasMixedProcessSenders &&
    !hasMixedProcessBrands &&
    previewSelectionMatches &&
    authMatchesSelection;
  const processButtonLabel = (() => {
    if (!processPreview) return 'Preparing...';
    if (hasMixedProcessBrands) return 'Process each brand separately';
    if (hasMixedProcessSenders) return 'Process each Google sender separately';
    if (!previewSelectionMatches) return 'Refresh preview for selected source/options';
    if (!authMatchesSelection) {
      return isAuthStatusLoading
        ? 'Checking Google connection...'
        : `Connect ${senderAccountEmail(selectedSenderAccountKey)} Google`;
    }
    if (previewActionable === 0) return 'Nothing new to process';
    if (previewSummary?.demoScheduled) {
      return `Confirm & Process ${previewSummary.demoScheduled} New Row${previewSummary.demoScheduled === 1 ? '' : 's'}`;
    }
    return `Confirm & Process ${previewActionable} Action${previewActionable === 1 ? '' : 's'}`;
  })();

  const sheetRequestMeta = () =>
    source.type === 'google-sheet'
      ? {
          sourceType: 'google-sheet' as const,
          spreadsheetId: source.spreadsheetId,
          sheetName: source.sheetName,
          headers: source.headers
        }
      : { sourceType: 'excel' as const };

  const processRequestMeta = (
    senderAccountKey: SenderAccountKey = selectedSenderAccountKey,
    emailBrandKey: EmailBrandKey = selectedEmailBrand,
    rowsForScope: ExcelRow[] = processTargetRows
  ) => {
    const selectedSourcePayload = selectedSourceScope
      ? {
          sourceId: selectedSourceScope.sourceId,
          sourceTabId: selectedSourceScope.sourceTabId,
          sourceSnapshotId: selectedSourceScope.sourceSnapshotId,
          googleAccountKey: selectedSourceScope.googleAccountKey,
          selectedSourceRowIds:
            rowsForScope.length > 0
              ? rowsForScope.map((row) => row.__sourceRowId || row.id).filter(Boolean)
              : undefined
        }
      : {};
    return {
      ...sheetRequestMeta(),
      ...selectedSourcePayload,
      workspaceKey,
      senderAccountKey,
      emailBrandKey,
      emailBrand: emailBrandKey
    };
  };

  function selectedSourceScopeMatches(incoming?: {
    sourceId?: string;
    sourceTabId?: string;
    sourceSnapshotId?: string;
  }) {
    if (!incoming?.sourceId && !incoming?.sourceTabId && !incoming?.sourceSnapshotId) return true;
    const current = selectedSourceScopeRef.current;
    return Boolean(
      current &&
        incoming.sourceId === current.sourceId &&
        incoming.sourceTabId === current.sourceTabId &&
        (!incoming.sourceSnapshotId || incoming.sourceSnapshotId === current.sourceSnapshotId)
    );
  }

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

  const reconcileRows = async (rowsToReconcile: ExcelRow[], generation = getWorkspaceGeneration()) => {
    if (rowsToReconcile.length === 0) return rowsToReconcile;
    const signal = createWorkspaceRequestSignal('reconcile');
    try {
      const res = await fetch('/api/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ rows: rowsToReconcile, workspaceKey })
      });
      if (!res.ok || !isCurrentWorkspace(generation)) return rowsToReconcile;
      const data = await res.json();
      return Array.isArray(data.rows) ? data.rows : rowsToReconcile;
    } finally {
      clearWorkspaceRequestSignal('reconcile', signal);
    }
  };

  const fetchAuthStatus = async (senderAccountKey: SenderAccountKey = selectedSenderAccountKey) => {
    setIsAuthStatusLoading(true);
    setAuthStatus(null);
    try {
      const res = await fetch(`/api/google-senders/${encodeURIComponent(senderAccountKey)}/status`);
      if (!res.ok) throw new Error('Status server unreachable');
      const data = await res.json();
      if (selectedSenderAccountKeyRef.current === senderAccountKey) {
        setAuthStatus(data);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Auth status failed';
      if (selectedSenderAccountKeyRef.current === senderAccountKey) {
        toast.error(`Failed to load Google auth: ${message}`);
      }
    } finally {
      if (selectedSenderAccountKeyRef.current === senderAccountKey) {
        setIsAuthStatusLoading(false);
      }
    }
  };

  const fetchProcessQueueConfig = async () => {
    try {
      const res = await fetch('/api/process-leads/queue-config');
      if (!res.ok) return;
      const data = await res.json();
      setProcessQueueEnabled(!!data.enabled);
    } catch {
      setProcessQueueEnabled(false);
    }
  };

  const fetchDashboardTrend = async (scope: DashboardRequestScope, signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/dashboard/trend?emailBrand=${encodeURIComponent(scope.emailBrand)}&days=7`, { signal });
      if (!res.ok) throw new Error('Trend server unreachable');
      const data = await res.json();
      if (isCurrentDashboardScope(scope) && data.emailBrand === scope.emailBrand) {
        setDashboardTrendData(Array.isArray(data.data) ? data.data : []);
      }
    } catch (err: unknown) {
      if (!isAbortError(err)) {
        console.error('Failed to load dashboard trend:', err);
      }
    }
  };

  const fetchDashboardActivity = async (scope: DashboardRequestScope, signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/dashboard/activity?emailBrand=${encodeURIComponent(scope.emailBrand)}&limit=25`, { signal });
      if (!res.ok) throw new Error('Activity server unreachable');
      const data = await res.json();
      if (isCurrentDashboardScope(scope) && data.emailBrand === scope.emailBrand) {
        setDashboardActivityEvents(Array.isArray(data.data) ? data.data : []);
      }
    } catch (err: unknown) {
      if (!isAbortError(err)) {
        console.error('Failed to load dashboard activity:', err);
      }
    }
  };

  const fetchDashboardHealth = async (scope: DashboardRequestScope, signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/dashboard/health?emailBrand=${encodeURIComponent(scope.emailBrand)}`, { signal });
      if (!res.ok) throw new Error('Health server unreachable');
      const data = await res.json();
      if (isCurrentDashboardScope(scope) && data.emailBrand === scope.emailBrand) {
        setDashboardHealthSummary(data.data || null);
      }
    } catch (err: unknown) {
      if (!isAbortError(err)) {
        console.error('Failed to load dashboard health:', err);
      }
    }
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    window.localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    selectedEmailBrandRef.current = selectedEmailBrand;
  }, [selectedEmailBrand]);

  useEffect(() => {
    selectedSenderAccountKeyRef.current = selectedSenderAccountKey;
  }, [selectedSenderAccountKey]);

  useEffect(() => {
    selectedSourceScopeRef.current = selectedSourceScope;
  }, [selectedSourceScope]);

  useEffect(() => {
    workspaceKeyRef.current = workspaceKey;
  }, [workspaceKey]);

  useEffect(() => {
    fetchAuthStatus(selectedSenderAccountKey);
    fetchProcessQueueConfig();
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        let senderAccountKey = selectedSenderAccountKeyRef.current;
        try {
          senderAccountKey = parseSenderAccountKey(event.data?.senderAccountKey);
        } catch {
          // Older callback payloads did not include a canonical sender key.
        }
        fetchAuthStatus(senderAccountKey);
        if (senderAccountKey === selectedSenderAccountKeyRef.current) {
          toast.success('Google account linked successfully.');
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [selectedSenderAccountKey]);

  useEffect(() => {
    const controller = new AbortController();
    dashboardRequestControllerRef.current?.abort();
    dashboardRequestControllerRef.current = controller;
    const scope = createDashboardScope();
    setDashboardTrendData([]);
    setDashboardActivityEvents([]);
    setDashboardHealthSummary(null);
    void fetchDashboardTrend(scope, controller.signal);
    void fetchDashboardActivity(scope, controller.signal);
    void fetchDashboardHealth(scope, controller.signal);
    return () => {
      controller.abort();
      if (dashboardRequestControllerRef.current === controller) {
        dashboardRequestControllerRef.current = null;
      }
    };
  }, [
    workspaceKey,
    selectedEmailBrand,
    lastSummary?.scheduled,
    lastSummary?.demoScheduled,
    lastSummary?.reschedule,
    lastSummary?.demoDone,
    lastSummary?.noResponse
  ]);

  useEffect(() => () => abortWorkspaceRequests(), []);

  useEffect(() => {
    try {
      if (rows.length > 0) window.localStorage.setItem(workspaceStorageKey(workspaceBrand, 'rows'), JSON.stringify(rows));
      else window.localStorage.removeItem(workspaceStorageKey(workspaceBrand, 'rows'));
    } catch {}
  }, [rows, workspaceBrand]);

  useEffect(() => {
    try {
      window.localStorage.setItem(workspaceStorageKey(workspaceBrand, 'selectedRowIds'), JSON.stringify(Array.from(selectedRowIds)));
    } catch {}
  }, [selectedRowIds, workspaceBrand]);

  useEffect(() => {
    try {
      window.localStorage.setItem(workspaceStorageKey(workspaceBrand, 'source'), JSON.stringify(source));
    } catch {}
  }, [source, workspaceBrand]);

  useEffect(() => {
    try {
      window.localStorage.setItem(EMAIL_BRAND_STORAGE_KEY, selectedEmailBrand);
    } catch {}
  }, [selectedEmailBrand]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SENDER_ACCOUNT_STORAGE, selectedSenderAccountKey);
    } catch {}
  }, [selectedSenderAccountKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WORKSPACE_KEY_STORAGE, workspaceKey);
    } catch {}
  }, [workspaceKey]);

  useEffect(() => {
    if (didReconcileStoredRows.current || rows.length === 0) return;
    didReconcileStoredRows.current = true;
    const generation = getWorkspaceGeneration();
    reconcileRows(rows, generation)
      .then((reconciled) => {
        if (!isCurrentWorkspace(generation)) return;
        setRows(reconciled);
        setSelectedRowIds(
          new Set(reconciled.filter((row) => canProcessLead(row)).map((row) => row.id))
        );
      })
      .catch((err: unknown) => {
        if (!isAbortError(err)) console.error(err);
      });
  }, [rows]);

  useEffect(() => {
    if (activeView === 'import') {
      importRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [activeView]);

  const handleDataParsed = async (parsedRows: ExcelRow[]) => {
    const generation = getWorkspaceGeneration();
    const reconciledRows = await reconcileRows(parsedRows, generation).catch((err: unknown) => {
      if (isAbortError(err)) return null;
      throw err;
    });
    if (!reconciledRows) return;
    if (!isCurrentWorkspace(generation)) return;
    setWorkspaceBrand(workspaceKey);
    setSelectedSourceScope(null);
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
    const generation = getWorkspaceGeneration();
    if (!isCurrentWorkspace(generation)) return;
    setWorkspaceBrand(workspaceKey);
    setSelectedSourceScope(null);
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
    const generation = getWorkspaceGeneration();
    const signal = createWorkspaceRequestSignal('google-sheet-sync');
    isSyncingRef.current = true;
    setIsProcessing(true);
    setProcessingProgress(null);
    try {
      const res = await fetch('/api/sheets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          spreadsheetId: source.spreadsheetId,
          sheetName: source.sheetName,
          headers: source.headers,
          workspaceKey
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      if (!isCurrentWorkspace(generation)) return;
      const updatedRows = Array.isArray(data.rows) ? data.rows : [];
      setRows(updatedRows);
      if (Array.isArray(data.headers)) setSource({ ...source, headers: data.headers });
      setLastSummary(applyProcessSummary(data.summary, updatedRows.length));
      setSelectedRowIds(new Set(updatedRows.filter((row) => canProcessLead(row)).map((row) => row.id)));
      if (showToast) toast.success(data.skippedDueToLock ? 'Sync already running' : 'Google Sheet refreshed');
    } catch (err: unknown) {
      if (isAbortError(err)) return;
      if (isCurrentWorkspace(generation) && showToast) toast.error(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      clearWorkspaceRequestSignal('google-sheet-sync', signal);
      if (isCurrentWorkspace(generation)) {
        setIsProcessing(false);
        isSyncingRef.current = false;
      }
    }
  };

  const openProcessPreflight = async (
    targetRows: ExcelRow[],
    options: { senderAccountKey?: SenderAccountKey; emailBrandKey?: EmailBrandKey } = {}
  ) => {
    if (targetRows.length === 0) {
      toast.error('No processable rows selected.');
      return;
    }

    const lockedBrands = getLockedBrandsForRows(targetRows);
    if (lockedBrands.length > 1) {
      toast.error('This selection contains rows from both brands. Process each brand separately.');
      return;
    }
    const lockedSenderAccounts = getLockedSenderAccountsForRows(targetRows);
    if (lockedSenderAccounts.length > 1) {
      toast.error('This selection contains rows from multiple Google sender accounts. Process each sender separately.');
      return;
    }
    const previewSenderAccountKey = lockedSenderAccounts[0] || options.senderAccountKey || selectedSenderAccountKey;
    const previewEmailBrandKey = lockedBrands[0] || options.emailBrandKey || selectedEmailBrand;
    if (previewSenderAccountKey !== selectedSenderAccountKey) {
      setSelectedSenderAccountKey(previewSenderAccountKey);
      void fetchAuthStatus(previewSenderAccountKey);
    }

    const generation = getWorkspaceGeneration();
    const signal = createWorkspaceRequestSignal('process-preview');
    setProcessTargetRows(targetRows);
    setProcessPreview(null);
    setIsPreflightLoading(true);

    try {
      const res = await fetch('/api/process-leads/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ rows: targetRows, ...processRequestMeta(previewSenderAccountKey, previewEmailBrandKey, targetRows) })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.requiredBrand === 'tallykonnect' || data.requiredBrand === 'anywheretally') {
          setSelectedEmailBrand(data.requiredBrand);
        }
        throw new Error(data.error || 'Process preview failed.');
      }

      if (!isCurrentWorkspace(generation)) return;
      if (!selectedSourceScopeMatches(data.sourceScope || data)) {
        toast.info('Selection changed. Refresh preview for the selected tab.');
        return;
      }
      setProcessPreview(data);
      setConfirmProcessOpen(true);
    } catch (err: unknown) {
      if (isAbortError(err)) return;
      if (!isCurrentWorkspace(generation)) return;
      toast.error(err instanceof Error ? err.message : 'Process preview failed');
      Object.entries(statusRevertMap).forEach(([rowId, previous]) =>
        revertRowStatus(rowId, previous as LeadStatusLabel | 'Failed' | '')
      );
      setStatusRevertMap({});
    } finally {
      clearWorkspaceRequestSignal('process-preview', signal);
      if (isCurrentWorkspace(generation)) setIsPreflightLoading(false);
    }
  };

  const applyProcessResult = (
    updatedRows: ExcelRow[],
    rawSummary: ScheduleSummary | undefined,
    headers?: string[],
    sheetSyncError?: string
  ) => {
    const summary = applyProcessSummary(rawSummary, processTargetRows.length);
    const updatedById = new Map(updatedRows.map((row) => [row.id, row]));
    setWorkspaceBrand(workspaceKey);
    setRows((current) => current.map((row) => updatedById.get(row.id) || row));
    if (source.type === 'google-sheet' && Array.isArray(headers)) {
      setSource({ ...source, headers });
    }
    setLastSummary(summary);
    setSelectedRowIds(new Set());
    if (sheetSyncError) {
      toast.warning(`Lead processing completed, but Sheet update failed: ${sheetSyncError}`);
    } else {
      toast.success('Lead processing completed');
    }
  };

  const clearSelectedSourceRows = () => {
    setRows([]);
    setSelectedRowIds(new Set());
    setProcessTargetRows([]);
    setProcessPreview(null);
    setSelectedSourceScope(null);
  };

  const handleSelectedTabPrepared = async (input: {
    rows: ExcelRow[];
    source: SheetSource;
    scope: SourceSelectionScope;
  }) => {
    const generation = getWorkspaceGeneration();
    if (!isCurrentWorkspace(generation)) return;
    setWorkspaceBrand(input.scope.workspaceKey);
    setSource(input.source);
    setSelectedSourceScope(input.scope);
    setRows(input.rows);
    const initiallySelected = new Set<string>();
    input.rows.forEach((row) => {
      if (canProcessLead(row)) initiallySelected.add(row.id);
    });
    setSelectedRowIds(initiallySelected);
    setActiveView('dashboard');
    toast.success(`Prepared ${input.rows.length} row(s) from "${input.scope.sourceTabName}"`);
    await openProcessPreflight(input.rows);
  };

  const pollProcessJob = async (jobId: string, generation: number, signal: AbortSignal) => {
    while (true) {
      await abortableDelay(2000, signal);
      if (!isCurrentWorkspace(generation)) return;
      const res = await fetch(`/api/process-leads/jobs/${encodeURIComponent(jobId)}`, { signal });
      const data: ProcessLeadJobResponse = await res.json();
      if (!res.ok) throw new Error(data.error || 'Process job lookup failed.');
      if (!isCurrentWorkspace(generation)) return;

      const progress = data.progress;
      if (progress) {
        setProcessingProgress({
          current: Math.min(progress.processed, progress.total),
          total: progress.total,
          success: progress.success,
          failed: progress.failed,
          skipped: progress.skipped,
          currentName: progress.currentName || 'Processing leads',
          currentEmail: progress.currentEmail,
          currentStep: data.status === 'QUEUED' ? 'Queued' : 'Processing in background',
          stepIndex: data.status === 'QUEUED' ? 0 : 1,
          steps: ['Queued', 'Processing in background', 'Updating results', 'Done']
        });
      }

      if (data.status === 'COMPLETED') {
        if (!isCurrentWorkspace(generation)) return;
        if (!selectedSourceScopeMatches(data.sourceScope || data)) {
          toast.info('Previous selected sheet finished in the background.');
          return;
        }
        applyProcessResult(data.rows || [], data.summary, data.headers, data.sheetSyncError);
        return;
      }

      if (data.status === 'FAILED') {
        throw new Error(data.error || 'Background processing failed.');
      }
    }
  };

  const runQueuedProcessRows = async (generation: number) => {
    const queueSignal = createWorkspaceRequestSignal('lead-processing');
    let data: ProcessLeadJobResponse;
    try {
      const res = await fetch('/api/process-leads/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: queueSignal,
        body: JSON.stringify({ rows: processTargetRows, ...processRequestMeta() })
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to queue lead processing.');
    } finally {
      clearWorkspaceRequestSignal('lead-processing', queueSignal);
    }

    if (!isCurrentWorkspace(generation)) return;

    setProcessingProgress({
      current: 0,
      total: processTargetRows.length,
      success: 0,
      failed: 0,
      skipped: processPreview?.summary.skipped || 0,
      currentName: 'Queued for background processing',
      currentStep: 'Queued',
      stepIndex: 0,
      steps: ['Queued', 'Processing in background', 'Updating results', 'Done']
    });
    toast.info('Processing queued in background...');
    const pollSignal = createWorkspaceRequestSignal('process-polling');
    try {
      await pollProcessJob(data.jobId, generation, pollSignal);
    } finally {
      clearWorkspaceRequestSignal('process-polling', pollSignal);
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

    if (!canConfirmProcess) {
      toast.error('Check the selected sender account and Google connection before processing.');
      return;
    }

    const generation = getWorkspaceGeneration();
    setConfirmProcessOpen(false);
    setIsProcessing(true);
    setLastSummary(null);

    if (processQueueEnabled) {
      try {
        await runQueuedProcessRows(generation);
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        if (!isCurrentWorkspace(generation)) return;
        const message = err instanceof Error ? err.message : 'Lead processing failed';
        toast.error(message);
        Object.entries(statusRevertMap).forEach(([rowId, previous]) =>
          revertRowStatus(rowId, previous as LeadStatusLabel | 'Failed' | '')
        );
      } finally {
        if (isCurrentWorkspace(generation)) {
          setIsProcessing(false);
          setProcessingProgress(null);
          setStatusRevertMap({});
          setProcessTargetRows([]);
          setProcessPreview(null);
        }
      }
      return;
    }

    setProcessingProgress({
      current: 0,
      total: processTargetRows.length,
      success: 0,
      failed: 0,
      skipped: 0,
      isIndeterminate: true,
      statusLabel: 'Waiting for backend result',
      currentName: 'Processing on server',
      currentStep: 'Processing on server',
      stepIndex: 0,
      steps: ['Processing on server']
    });
    toast.info('Processing started...');

    const signal = createWorkspaceRequestSignal('lead-processing');
    try {
      const res = await fetch('/api/process-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ rows: processTargetRows, ...processRequestMeta() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lead processing failed.');
      if (!isCurrentWorkspace(generation)) return;

      const updatedRows: ExcelRow[] = Array.isArray(data.rows) ? data.rows : [];
      applyProcessResult(updatedRows, data.summary, data.headers, data.sheetSyncError);
    } catch (err: unknown) {
      if (isAbortError(err)) return;
      if (!isCurrentWorkspace(generation)) return;
      const message = err instanceof Error ? err.message : 'Lead processing failed';
      toast.error(message);
      Object.entries(statusRevertMap).forEach(([rowId, previous]) =>
        revertRowStatus(rowId, previous as LeadStatusLabel | 'Failed' | '')
      );
    } finally {
      clearWorkspaceRequestSignal('lead-processing', signal);
      if (isCurrentWorkspace(generation)) {
        setIsProcessing(false);
        setProcessingProgress(null);
        setStatusRevertMap({});
        setProcessTargetRows([]);
        setProcessPreview(null);
      }
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
          ...processRequestMeta()
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
          ...processRequestMeta()
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
      const res = await fetch(`/api/google-senders/${encodeURIComponent(selectedSenderAccountKey)}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error('Server failure rejecting disconnect command.');
      const data = await res.json();
      if (data.status) {
        setAuthStatus(data.status);
        setIsAuthStatusLoading(false);
      } else {
        await fetchAuthStatus(selectedSenderAccountKey);
      }
      toast.success('Google session cleared. Connect again to continue.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Clear session failed');
    }
  };

  const clearWorkspaceState = (targetWorkspaceKey: WorkspaceKey = workspaceBrand) => {
    workspaceGenerationRef.current += 1;
    abortWorkspaceRequests();
    abortDashboardRequests();
    removeStoredWorkspace(targetWorkspaceKey);
    setWorkspaceBrand(targetWorkspaceKey);
    setRows([]);
    setSelectedRowIds(new Set());
    setSource({ type: 'excel' });
    didReconcileStoredRows.current = false;
    resetTransientWorkspaceUi();
    setActiveView('dashboard');
  };

  const cancelWorkspaceRequestsForReset = () => {
    workspaceGenerationRef.current += 1;
    abortWorkspaceRequests();
    abortDashboardRequests();
    isSyncingRef.current = false;
    setIsProcessing(false);
    setIsLoadingFile(false);
    setIsPreflightLoading(false);
    setProcessingProgress(null);
    setProcessTargetRows([]);
    setProcessPreview(null);
    setStatusRevertMap({});
    setConfirmProcessOpen(false);
  };

  const clearWorkspace = () => {
    const confirmed = window.confirm('Clear imported rows from this browser? This will not delete Google Sheet or database data.');
    if (!confirmed) return;

    clearWorkspaceState();
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

  const isAuthActive = authMatchesSelection;
  const showLeadsSection = rows.length > 0 && activeView === 'leads';
  const showImport = activeView === 'leads' || activeView === 'import';
  const viewCopy = getViewCopy(activeView);

  return (
    <TooltipProvider>
        <AppShell
          authStatus={authStatus}
          pageTitle={viewCopy.title}
          pageDescription={viewCopy.description}
        onRefreshAuth={() => fetchAuthStatus(selectedSenderAccountKey)}
        onClearAuth={() => setConfirmClearAuthOpen(true)}
        source={source}
        onSyncNow={source.type === 'google-sheet' ? () => syncGoogleSheet(true) : undefined}
        isSyncing={isProcessing}
        activeView={activeView}
        onNavigate={setActiveView}
        notificationCounts={notificationCounts}
        isDark={isDark}
        onToggleTheme={() => setIsDark((prev) => !prev)}
      >
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">{viewCopy.title}</p>
          <p className="max-w-3xl text-sm text-muted-foreground">{viewCopy.description}</p>
        </div>

        {activeView === 'settings' ? (
          <SettingsPanel
            emailBrand={selectedEmailBrand}
            onResetStart={cancelWorkspaceRequestsForReset}
            onResetComplete={() => {
              clearWorkspaceState(workspaceKey);
              toast.success(`${emailBrandLabel(selectedEmailBrand)} workflow and browser workspace reset. Import a fresh sheet to continue.`);
            }}
          />
        ) : (
          <>
            {rows.length > 0 && activeView === 'dashboard' && (
              <DashboardOverview
                rows={rows}
                stats={stats}
                trendData={dashboardTrendData}
                activityEvents={dashboardActivityEvents}
                healthSummary={dashboardHealthSummary}
                authStatus={authStatus}
                isAuthStatusLoading={isAuthStatusLoading}
                workspaceKey={workspaceKey}
                emailBrand={selectedEmailBrand}
                senderAccountKey={selectedSenderAccountKey}
                selectedCount={selectedRowIds.size}
                onRunAutomation={() => openProcessPreflight(processTargetFromSelection)}
                onViewAllActivity={() => setActiveView('activity')}
              />
            )}

            {activeView === 'activity' && <ActivityView events={dashboardActivityEvents} />}
            {activeView === 'manual-review' && (
              <ManualReviewView rows={manualReviewRows} workspaceKey={workspaceKey} selectedEmailBrand={selectedEmailBrand} />
            )}
            {activeView === 'email-logs' && (
              <EmailLogsView rows={emailLogRows} workspaceKey={workspaceKey} selectedEmailBrand={selectedEmailBrand} />
            )}

            {showImport && (
              <div ref={importRef}>
                <ImportPanel
                  onExcelParsed={handleDataParsed}
                  onGoogleSheetParsed={handleGoogleSheetDataParsed}
                  onSourceSelectionChanged={clearSelectedSourceRows}
                  onSelectedTabPrepared={handleSelectedTabPrepared}
                  isLoading={isLoadingFile}
                  setIsLoading={setIsLoadingFile}
                  uploadedFileName={uploadedFileName}
                  setUploadedFileName={setUploadedFileName}
                  defaultTab={source.type === 'google-sheet' ? 'google-sheet' : 'excel'}
                  workspaceKey={workspaceKey}
                  getWorkspaceGeneration={getWorkspaceGeneration}
                  isCurrentWorkspace={isCurrentWorkspace}
                  createWorkspaceRequestSignal={createWorkspaceRequestSignal}
                  clearWorkspaceRequestSignal={clearWorkspaceRequestSignal}
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
                  workspaceKey={workspaceKey}
                  selectedEmailBrand={selectedEmailBrand}
                />
              </>
            )}

            {rows.length === 0 &&
              activeView !== 'import' &&
              activeView !== 'settings' &&
              activeView !== 'manual-review' &&
              activeView !== 'email-logs' && (
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
                workspaceKey={workspaceKey}
                selectedEmailBrand={selectedEmailBrand}
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
            setProcessTargetRows([]);
            setProcessPreview(null);
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
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Processing source</p>
                        <p className="mt-1 text-base font-semibold">
                          {processPreview.summary.total} row(s) found from {source.type === 'google-sheet' ? 'Google Sheet' : 'Excel'}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Only the selected tab will be processed.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                        <Clock3 className="h-4 w-4" />
                        Estimated time: <span className="font-medium text-foreground">{processPreview.estimatedTime.label}</span>
                      </div>
                    </div>

                    {(processPreview.sourceScope || selectedSourceScope) && (
                      <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          <p className="text-muted-foreground">Source Workspace</p>
                          <p className="font-medium">{processPreview.sourceScope?.workspaceKey || selectedSourceScope?.workspaceKey}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Source Name</p>
                          <p className="font-medium">{processPreview.sourceDisplayName || selectedSourceScope?.sourceDisplayName}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Selected Tab</p>
                          <p className="font-medium">{processPreview.sourceTabName || selectedSourceScope?.sourceTabName}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Snapshot</p>
                          <p className="font-medium">{processPreview.sourceSnapshotId || selectedSourceScope?.sourceSnapshotId}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Email Brand</p>
                          <p className="font-medium">{emailBrandLabel(selectedEmailBrand)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Sheet Account</p>
                          <p className="font-medium">
                            {processPreview.sourceScope?.googleAccountKey || selectedSourceScope?.googleAccountKey || 'Not applicable'}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">Total rows</p>
                        <p className="mt-1 text-2xl font-semibold">{processPreview.summary.total}</p>
                      </div>
                      <div className="rounded-lg border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">Already processed / skipped</p>
                        <p className="mt-1 text-2xl font-semibold">{processPreview.summary.skipped}</p>
                      </div>
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
                        <p className="text-xs">New demo emails</p>
                        <p className="mt-1 text-2xl font-semibold">{processPreview.summary.demoScheduled}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border bg-card p-4">
                  <div className="flex flex-col gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Google sending account</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {processLockedSenderAccountKey
                          ? `Existing lifecycle rows must continue from ${senderAccountEmail(processLockedSenderAccountKey)}.`
                          : 'Choose which Google account creates Calendar events and sends Gmail messages.'}
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {SENDER_ACCOUNT_KEYS.map((senderKey) => {
                        const selected = selectedSenderAccountKey === senderKey;
                        const disabled = !!processLockedSenderAccountKey && processLockedSenderAccountKey !== senderKey;
                        return (
                          <button
                            key={senderKey}
                            type="button"
                            disabled={disabled}
                            className={cn(
                              'rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                              selected
                                ? 'border-primary bg-primary/10 text-foreground'
                                : 'border-border bg-background hover:bg-muted/60'
                            )}
                            onClick={() => {
                              if (disabled || senderKey === selectedSenderAccountKey) return;
                              setSelectedSenderAccountKey(senderKey);
                              void fetchAuthStatus(senderKey);
                              void openProcessPreflight(processTargetRows, { senderAccountKey: senderKey });
                            }}
                          >
                            <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                              <span>{senderAccountLabel(senderKey)}</span>
                              {processLockedSenderAccountKey === senderKey && (
                                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                                  Owner
                                </span>
                              )}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">{senderAccountEmail(senderKey)}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                      Google status:{' '}
                      {isAuthStatusLoading
                        ? 'checking connection...'
                        : authMatchesSelection
                          ? `connected as ${authStatus?.email || senderAccountEmail(selectedSenderAccountKey)}`
                          : `connect ${senderAccountEmail(selectedSenderAccountKey)} before processing`}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border bg-card p-4">
                  <div className="flex flex-col gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email appearance</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Choose the logo, website, footer, and template copy. This does not change the lead source.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {EMAIL_BRANDS.map((brand) => {
                        const selected = selectedEmailBrand === brand.key;
                        return (
                          <button
                            key={brand.key}
                            type="button"
                            className={cn(
                              'rounded-lg border p-3 text-left transition-colors',
                              selected
                                ? 'border-primary bg-primary/10 text-foreground'
                                : 'border-border bg-background hover:bg-muted/60'
                            )}
                            onClick={() => {
                              if (brand.key === selectedEmailBrand) return;
                              setSelectedEmailBrand(brand.key);
                              void openProcessPreflight(processTargetRows, { emailBrandKey: brand.key });
                            }}
                          >
                            <span className="text-sm font-semibold">{brand.label}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">{brand.description}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <PreviewStat icon={<Mail className="h-4 w-4" />} label="New demo scheduled emails" value={processPreview.summary.demoScheduled} tone="blue" />
                  <PreviewStat icon={<Send className="h-4 w-4" />} label="Reschedule emails" value={processPreview.summary.reschedule} tone="cyan" />
                  <PreviewStat icon={<CheckCircle2 className="h-4 w-4" />} label="Thank-you emails" value={processPreview.summary.demoDone} tone="green" />
                  <PreviewStat icon={<Users className="h-4 w-4" />} label="Not Attended emails" value={processPreview.summary.noResponse ?? 0} tone="amber" />
                  <PreviewStat label="Status-only updates" value={processPreview.summary.statusOnly} />
                  <PreviewStat label="Already processed / skipped" value={processPreview.summary.skipped} />
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
                  <RecipientList title="Not Attended email recipients" recipients={processPreview.noResponseRecipients ?? []} />
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
              disabled={!canConfirmProcess}
            >
              {processButtonLabel}
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
      description: 'Review workload, delivery health, and demo scheduling automation progress from one place.'
    },
    leads: {
      title: 'Leads',
      description: 'Manage every lead, meeting slot, status badge, remark, and row-level action.'
    },
    automations: {
      title: 'Automations',
      description: 'Process selected leads through validation, calendar creation, email sending, and sheet updates.'
    },
    activity: {
      title: 'Activity',
      description: 'Review every automation activity item for the current workspace.'
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
