import { ClipboardCheck, Download, RefreshCw, Search, XCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { LEAD_STATUS_OPTIONS } from '@/src/lib/leadStatus';
import { SheetSource } from '@/src/types';

interface ActionToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  selectedCount: number;
  readyCount: number;
  isProcessing: boolean;
  isAuthActive: boolean;
  source: SheetSource;
  onSelectAllReady: () => void;
  onClearSelection: () => void;
  onClearWorkspace: () => void;
  onProcess: () => void;
  onSyncNow?: () => void;
  onExport: () => void;
}

export default function ActionToolbar({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  selectedCount,
  readyCount,
  isProcessing,
  isAuthActive,
  source,
  onSelectAllReady,
  onClearSelection,
  onClearWorkspace,
  onProcess,
  onSyncNow,
  onExport
}: ActionToolbarProps) {
  const isGoogleSheet = source.type === 'google-sheet';

  return (
    <div className="space-y-3">
      {!isAuthActive && (
        <Alert variant="destructive">
          <AlertDescription>Google is not connected. Link your account in the header before scheduling.</AlertDescription>
        </Alert>
      )}

      {isGoogleSheet && (
        <Alert>
          <AlertDescription>Google Sheet will be updated directly after processing.</AlertDescription>
        </Alert>
      )}

      <div className="tk-premium-card p-4">
        <div className="mb-3 flex flex-col gap-1 border-b pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold">Lead workspace</p>
            <p className="text-xs text-muted-foreground">Filter, select, and run only the rows that are ready.</p>
          </div>
          <div className="flex w-fit items-center gap-2 rounded-full bg-violet-50 px-3 py-2 text-xs text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
            <span className="font-semibold">{selectedCount}</span> selected
            <span className="h-3 w-px bg-border" />
            <span className="font-semibold">{readyCount}</span> processable
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search name or email..."
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={onStatusFilterChange}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="Failed">Needs fix</SelectItem>
              {LEAD_STATUS_OPTIONS.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onSelectAllReady}>
            Select processable
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClearSelection}>
            <XCircle className="h-4 w-4" />
            Clear
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onClearWorkspace} disabled={isProcessing}>
            Clear workspace
          </Button>
          {!isGoogleSheet && (
            <Button type="button" variant="outline" size="sm" onClick={onExport}>
              <Download className="h-4 w-4" />
              Download Updated Excel
            </Button>
          )}
          {isGoogleSheet && onSyncNow && (
            <Button type="button" variant="outline" size="sm" onClick={onSyncNow} disabled={isProcessing}>
              <RefreshCw className="h-4 w-4" />
              Sync Now
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-violet-500/20 hover:from-indigo-500 hover:to-violet-500"
            onClick={onProcess}
            disabled={!isAuthActive || isProcessing || selectedCount === 0}
          >
            <ClipboardCheck className="h-4 w-4" />
            Run Automation
          </Button>
        </div>
        </div>
      </div>
    </div>
  );
}
