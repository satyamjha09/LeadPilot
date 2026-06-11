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

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
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

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">
            {selectedCount} selected | {readyCount} processable
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onSelectAllReady}>
            Select processable
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClearSelection}>
            <XCircle className="h-4 w-4" />
            Clear
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
            onClick={onProcess}
            disabled={!isAuthActive || isProcessing || selectedCount === 0}
          >
            <ClipboardCheck className="h-4 w-4" />
            Review & Process
          </Button>
        </div>
      </div>
    </div>
  );
}
