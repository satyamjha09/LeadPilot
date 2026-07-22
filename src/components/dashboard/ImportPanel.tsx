import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, Link2, Loader2, PlayCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExcelRow, RegisteredSource, RegisteredSourceTab, SheetSource, SourceSelectionScope } from '@/src/types';
import type { WorkspaceKey } from '@/src/lib/senderAccount';

type RequestKey = 'excel-preview' | 'google-sheet-import';

interface ImportPanelProps {
  onExcelParsed: (rows: ExcelRow[]) => void | Promise<void>;
  onGoogleSheetParsed: (rows: ExcelRow[], source: SheetSource) => void | Promise<void>;
  onSourceSelectionChanged: () => void;
  onSelectedTabPrepared: (input: {
    rows: ExcelRow[];
    source: SheetSource;
    scope: SourceSelectionScope;
  }) => void | Promise<void>;
  workspaceKey: WorkspaceKey;
  isLoading: boolean;
  setIsLoading: (val: boolean) => void;
  uploadedFileName: string | null;
  setUploadedFileName: (name: string | null) => void;
  defaultTab?: 'excel' | 'google-sheet';
  getWorkspaceGeneration: () => number;
  isCurrentWorkspace: (generation: number) => boolean;
  createWorkspaceRequestSignal: (key: RequestKey) => AbortSignal;
  clearWorkspaceRequestSignal: (key: RequestKey, signal: AbortSignal) => void;
}

function sourceTypeForUi(source: RegisteredSource) {
  return source.type === 'GOOGLE_SHEETS' ? 'google-sheet' : 'excel';
}

function sourceToSheetSource(source: RegisteredSource, tab: RegisteredSourceTab): SheetSource {
  if (source.type === 'GOOGLE_SHEETS') {
    return {
      type: 'google-sheet',
      spreadsheetId: String(source.externalFileId || ''),
      sheetName: tab.name,
      gid: tab.externalTabId,
      headers: Array.isArray(tab.headers) ? tab.headers : []
    };
  }
  return { type: 'excel' };
}

async function parseJsonError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  return data?.error || data?.message || fallback;
}

export default function ImportPanel({
  onSourceSelectionChanged,
  onSelectedTabPrepared,
  workspaceKey,
  isLoading,
  setIsLoading,
  uploadedFileName,
  setUploadedFileName,
  defaultTab = 'excel',
  getWorkspaceGeneration,
  isCurrentWorkspace,
  createWorkspaceRequestSignal,
  clearWorkspaceRequestSignal
}: ImportPanelProps) {
  const [adminToken, setAdminToken] = useState('');
  const [sources, setSources] = useState<RegisteredSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [selectedTabId, setSelectedTabId] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) || null,
    [selectedSourceId, sources]
  );
  const selectedTab = useMemo(
    () => selectedSource?.tabs.find((tab) => tab.id === selectedTabId) || null,
    [selectedSource, selectedTabId]
  );
  const enabledTabs = selectedSource?.tabs.filter((tab) => tab.isEnabled) || [];
  const requestHeaders = adminToken.trim() ? { 'x-multi-source-admin-token': adminToken.trim() } : undefined;

  const applySources = (nextSources: RegisteredSource[]) => {
    setSources(nextSources);
    const preferredSource =
      nextSources.find((source) => source.id === selectedSourceId) ||
      nextSources.find((source) => source.tabs.some((tab) => tab.isEnabled)) ||
      nextSources[0] ||
      null;
    setSelectedSourceId(preferredSource?.id || '');
    const preferredTab =
      preferredSource?.tabs.find((tab) => tab.id === selectedTabId && tab.isEnabled) ||
      preferredSource?.tabs.find((tab) => tab.isEnabled) ||
      null;
    setSelectedTabId(preferredTab?.id || '');
  };

  const loadSources = async () => {
    const generation = getWorkspaceGeneration();
    if (!requestHeaders) {
      setError('Enter the multi-source operator token for this browser session.');
      return;
    }
    setIsLoading(true);
    setError(null);
    const signal = createWorkspaceRequestSignal('google-sheet-import');
    try {
      const response = await fetch(`/api/v2/workspaces/${encodeURIComponent(workspaceKey)}/sources`, {
        headers: requestHeaders,
        signal
      });
      if (!response.ok) throw new Error(await parseJsonError(response, 'Source list failed.'));
      const data = await response.json();
      if (!isCurrentWorkspace(generation)) return;
      applySources(Array.isArray(data.sources) ? data.sources : []);
    } catch (err) {
      if (err instanceof DOMException ? err.name === 'AbortError' : err instanceof Error && err.name === 'AbortError') return;
      if (isCurrentWorkspace(generation)) setError(err instanceof Error ? err.message : 'Source list failed.');
    } finally {
      clearWorkspaceRequestSignal('google-sheet-import', signal);
      if (isCurrentWorkspace(generation)) setIsLoading(false);
    }
  };

  useEffect(() => {
    setSources([]);
    setSelectedSourceId('');
    setSelectedTabId('');
    setError(null);
  }, [workspaceKey]);

  const registerExcel = async (file: File) => {
    const generation = getWorkspaceGeneration();
    if (!requestHeaders) {
      setError('Enter the multi-source operator token before registering an Excel source.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setUploadedFileName(file.name);
    const signal = createWorkspaceRequestSignal('excel-preview');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('displayName', file.name);
      const response = await fetch(`/api/v2/workspaces/${encodeURIComponent(workspaceKey)}/sources/excel`, {
        method: 'POST',
        headers: requestHeaders,
        body: formData,
        signal
      });
      if (!response.ok) throw new Error(await parseJsonError(response, 'Excel source registration failed.'));
      const data = await response.json();
      if (!isCurrentWorkspace(generation)) return;
      await loadSources();
      if (data.source?.id) {
        setSelectedSourceId(data.source.id);
        const firstEnabled = data.source.tabs?.find((tab: RegisteredSourceTab) => tab.isEnabled);
        setSelectedTabId(firstEnabled?.id || '');
      }
    } catch (err) {
      if (err instanceof DOMException ? err.name === 'AbortError' : err instanceof Error && err.name === 'AbortError') return;
      if (isCurrentWorkspace(generation)) {
        setUploadedFileName(null);
        setError(err instanceof Error ? err.message : 'Excel source registration failed.');
      }
    } finally {
      clearWorkspaceRequestSignal('excel-preview', signal);
      if (isCurrentWorkspace(generation)) setIsLoading(false);
    }
  };

  const registerGoogleSheet = async () => {
    const generation = getWorkspaceGeneration();
    if (!requestHeaders) {
      setError('Enter the multi-source operator token before registering a Google Sheet source.');
      return;
    }
    if (!sheetUrl.trim()) {
      setError('Paste a Google Sheets URL first.');
      return;
    }
    setIsLoading(true);
    setError(null);
    const signal = createWorkspaceRequestSignal('google-sheet-import');
    try {
      const response = await fetch(`/api/v2/workspaces/${encodeURIComponent(workspaceKey)}/sources/google-sheets`, {
        method: 'POST',
        headers: { ...requestHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetUrl: sheetUrl.trim() }),
        signal
      });
      if (!response.ok) throw new Error(await parseJsonError(response, 'Google Sheet source registration failed.'));
      const data = await response.json();
      if (!isCurrentWorkspace(generation)) return;
      await loadSources();
      if (data.source?.id) {
        setSelectedSourceId(data.source.id);
        const firstEnabled = data.source.tabs?.find((tab: RegisteredSourceTab) => tab.isEnabled);
        setSelectedTabId(firstEnabled?.id || '');
      }
    } catch (err) {
      if (err instanceof DOMException ? err.name === 'AbortError' : err instanceof Error && err.name === 'AbortError') return;
      if (isCurrentWorkspace(generation)) setError(err instanceof Error ? err.message : 'Google Sheet source registration failed.');
    } finally {
      clearWorkspaceRequestSignal('google-sheet-import', signal);
      if (isCurrentWorkspace(generation)) setIsLoading(false);
    }
  };

  const prepareSelectedTab = async () => {
    const generation = getWorkspaceGeneration();
    if (!requestHeaders || !selectedSource || !selectedTab || !selectedTab.isEnabled) return;
    setIsLoading(true);
    setError(null);
    const signal = createWorkspaceRequestSignal('google-sheet-import');
    const capturedSourceId = selectedSource.id;
    const capturedTabId = selectedTab.id;
    try {
      const response = await fetch(
        `/api/v2/workspaces/${encodeURIComponent(workspaceKey)}/sources/${encodeURIComponent(capturedSourceId)}/tabs/${encodeURIComponent(capturedTabId)}/prepare-processing`,
        {
          method: 'POST',
          headers: requestHeaders,
          signal
        }
      );
      if (!response.ok) throw new Error(await parseJsonError(response, 'Selected sheet preparation failed.'));
      const data = await response.json();
      if (!isCurrentWorkspace(generation)) return;
      if (capturedSourceId !== selectedSourceId || capturedTabId !== selectedTabId) return;
      const rows = Array.isArray(data.rows) ? data.rows : [];
      const scope: SourceSelectionScope = {
        workspaceKey,
        sourceId: data.source.id,
        sourceTabId: data.tab.id,
        sourceSnapshotId: data.snapshot.id,
        sourceType: data.source.type,
        sourceDisplayName: data.source.displayName,
        sourceTabName: data.tab.name,
        externalTabId: data.tab.externalTabId,
        googleAccountKey: data.googleAccountKey,
        generation
      };
      await onSelectedTabPrepared({
        rows,
        source: sourceToSheetSource(selectedSource, selectedTab),
        scope
      });
    } catch (err) {
      if (err instanceof DOMException ? err.name === 'AbortError' : err instanceof Error && err.name === 'AbortError') return;
      if (isCurrentWorkspace(generation)) setError(err instanceof Error ? err.message : 'Selected sheet preparation failed.');
    } finally {
      clearWorkspaceRequestSignal('google-sheet-import', signal);
      if (isCurrentWorkspace(generation)) setIsLoading(false);
    }
  };

  const canProcess = Boolean(requestHeaders && selectedSource && selectedTab?.isEnabled && !isLoading);

  return (
    <Card id="import-panel" className="tk-hover-card">
      <CardHeader>
        <CardTitle className="text-lg">Import Leads</CardTitle>
        <CardDescription>Select one source tab, then process only that selected sheet.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_auto]">
          <div className="space-y-2">
            <Label htmlFor="multi-source-token">Operator token</Label>
            <div className="relative">
              <ShieldCheck className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="multi-source-token"
                type="password"
                value={adminToken}
                onChange={(event) => setAdminToken(event.target.value)}
                placeholder="Required for source registration"
                className="pl-9"
              />
            </div>
          </div>
          <Button type="button" variant="outline" onClick={loadSources} disabled={isLoading || !adminToken.trim()}>
            <RefreshCw className="h-4 w-4" />
            Sources
          </Button>
        </div>

        <Tabs defaultValue={defaultTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="excel" className="gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Upload Excel
            </TabsTrigger>
            <TabsTrigger value="google-sheet" className="gap-2">
              <Link2 className="h-4 w-4" />
              Google Sheet URL
            </TabsTrigger>
          </TabsList>
          <TabsContent value="excel" className="mt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => event.target.files?.[0] && registerExcel(event.target.files[0])}
                disabled={isLoading}
              />
              {uploadedFileName && <span className="text-sm text-muted-foreground">{uploadedFileName}</span>}
            </div>
          </TabsContent>
          <TabsContent value="google-sheet" className="mt-4">
            <div className="flex gap-2">
              <Input
                type="url"
                value={sheetUrl}
                onChange={(event) => setSheetUrl(event.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                disabled={isLoading}
              />
              <Button type="button" onClick={registerGoogleSheet} disabled={isLoading}>
                Register
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Source</Label>
            <Select
              value={selectedSourceId}
              onValueChange={(value) => {
                setSelectedSourceId(value);
                const nextSource = sources.find((source) => source.id === value);
                setSelectedTabId(nextSource?.tabs.find((tab) => tab.isEnabled)?.id || '');
                onSourceSelectionChanged();
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select source" />
              </SelectTrigger>
              <SelectContent>
                {sources.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Tab</Label>
            <Select
              value={selectedTabId}
              onValueChange={(value) => {
                setSelectedTabId(value);
                onSourceSelectionChanged();
              }}
              disabled={!selectedSource}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select one tab" />
              </SelectTrigger>
              <SelectContent>
                {enabledTabs.map((tab) => (
                  <SelectItem key={tab.id} value={tab.id}>
                    {tab.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button type="button" onClick={prepareSelectedTab} disabled={!canProcess} className="w-full md:w-auto">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          Process Selected Sheet
        </Button>

        {selectedSource && (
          <p className="text-xs text-muted-foreground">
            {selectedSource.displayName}: {selectedSource.tabs.length} tab(s) detected. Changing the selector does not
            ingest or send anything.
          </p>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Source error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
