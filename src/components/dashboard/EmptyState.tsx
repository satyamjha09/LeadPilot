import { FileSpreadsheet, Link2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
          <FileSpreadsheet className="h-7 w-7 text-muted-foreground" />
        </div>
        <div className="max-w-md space-y-2">
          <h3 className="text-lg font-semibold">No leads imported yet</h3>
          <p className="text-sm text-muted-foreground">
            Upload an Excel file or paste a Google Sheet URL to begin scheduling meetings.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            .xlsx / .xls
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5" />
            Google Sheets URL
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
