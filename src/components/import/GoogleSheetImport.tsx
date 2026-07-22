import React, { useState } from 'react';
import { AlertTriangle, Link2, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ExcelRow, SheetSource } from '@/src/types';
import type { WorkspaceKey } from '@/src/lib/senderAccount';
import { apiFetch } from '@/src/lib/authClient';

interface GoogleSheetImportProps {
  onDataParsed: (rows: ExcelRow[], source: SheetSource) => void | Promise<void>;
  workspaceKey: WorkspaceKey;
  isLoading: boolean;
  setIsLoading: (val: boolean) => void;
  getWorkspaceGeneration: () => number;
  isCurrentWorkspace: (generation: number) => boolean;
  createWorkspaceRequestSignal: (key: 'google-sheet-import') => AbortSignal;
  clearWorkspaceRequestSignal: (key: 'google-sheet-import', signal: AbortSignal) => void;
}

export default function GoogleSheetImport({
  onDataParsed,
  workspaceKey,
  isLoading,
  setIsLoading,
  getWorkspaceGeneration,
  isCurrentWorkspace,
  createWorkspaceRequestSignal,
  clearWorkspaceRequestSignal
}: GoogleSheetImportProps) {
  const [sheetUrl, setSheetUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    const generation = getWorkspaceGeneration();
    const trimmedUrl = sheetUrl.trim();
    if (!trimmedUrl) {
      setError('Paste a Google Sheets URL first.');
      return;
    }

    setIsLoading(true);
    setError(null);

    const signal = createWorkspaceRequestSignal('google-sheet-import');
    try {
      const response = await apiFetch('/api/sheets/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ sheetUrl: trimmedUrl, workspaceKey })
      });

      if (!response.ok) {
        const errObj = await response.json().catch(() => null);
        throw new Error(errObj?.error || 'Google Sheet import failed.');
      }

      const data = await response.json();
      if (!Array.isArray(data.rows)) {
        throw new Error('Server returned invalid Google Sheet row data.');
      }

      const source: SheetSource = {
        type: 'google-sheet',
        spreadsheetId: data.spreadsheetId,
        sheetName: data.sheetName,
        gid: data.gid,
        headers: Array.isArray(data.headers) ? data.headers : []
      };

      if (!isCurrentWorkspace(generation)) return;
      await onDataParsed(data.rows, source);
    } catch (err: unknown) {
      if (err instanceof DOMException ? err.name === 'AbortError' : err instanceof Error && err.name === 'AbortError') {
        return;
      }
      if (!isCurrentWorkspace(generation)) return;
      const message = err instanceof Error ? err.message : 'Google Sheet import failed.';
      console.error(err);
      setError(message);
    } finally {
      clearWorkspaceRequestSignal('google-sheet-import', signal);
      if (isCurrentWorkspace(generation)) setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="google-sheet-url">Google Sheet URL</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="google-sheet-url"
              type="url"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="pl-9"
            />
          </div>
          <Button type="button" onClick={handleImport} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              'Import Google Sheet'
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Paste a Google Sheets URL. The app will update Meeting Details, lead_status, and Remarks directly in the sheet.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Google Sheet error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
