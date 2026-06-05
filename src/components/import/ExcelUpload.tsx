import React, { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, UploadCloud } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ExcelRow } from '@/src/types';

interface ExcelUploadProps {
  onDataParsed: (rows: ExcelRow[]) => void | Promise<void>;
  isLoading: boolean;
  setIsLoading: (val: boolean) => void;
  uploadedFileName: string | null;
  setUploadedFileName: (name: string | null) => void;
}

export default function ExcelUpload({
  onDataParsed,
  isLoading,
  setIsLoading,
  uploadedFileName,
  setUploadedFileName
}: ExcelUploadProps) {
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const maxFileSizeBytes = 10 * 1024 * 1024;

  const convertToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64str = reader.result as string;
        resolve(base64str.split(',')[1]);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleExcelFile = async (file: File) => {
    const isExcel =
      file.name.endsWith('.xlsx') ||
      file.name.endsWith('.xls') ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel';

    if (!isExcel) {
      setError('Unsupported file type. Please upload a valid .xlsx or .xls Excel sheet.');
      return;
    }

    if (file.size > maxFileSizeBytes) {
      setError('File is too large. Please upload an Excel file under 10 MB.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setUploadedFileName(file.name);

    try {
      const base64Data = await convertToBase64(file);
      const response = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: base64Data })
      });

      if (!response.ok) {
        const errObj = await response.json();
        throw new Error(errObj.error || 'Server rejected parsing task.');
      }

      const data = await response.json();
      if (!data.rows || !Array.isArray(data.rows)) {
        throw new Error('Server returned invalid row data.');
      }

      await onDataParsed(data.rows);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred during file parsing.';
      console.error(err);
      setError(message);
      setUploadedFileName(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) handleExcelFile(e.dataTransfer.files[0]);
  };

  const downloadSampleTemplate = async () => {
    const xlsx = await import('xlsx');
    const rows = [
      {
        full_name: 'John Doe',
        email: 'john@example.com',
        'Date of Demo': '2026-06-10',
        'Time of Demo': '2:30 PM',
        'Meeting Details': '',
        lead_status: 'Demo Scheduled' as const,
        Remarks: ''
      }
    ];
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Demo Schedules');
    const buffer = xlsx.write(workbook, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'excel_meet_scheduler_template.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Supported formats: .xlsx, .xls</p>
        <Button type="button" variant="ghost" size="sm" onClick={downloadSampleTemplate}>
          Download template
        </Button>
      </div>

      <div
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-10 transition-colors',
          dragActive ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => e.target.files?.[0] && handleExcelFile(e.target.files[0])}
          className="hidden"
        />

        {isLoading ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm font-medium">Parsing spreadsheet...</p>
          </div>
        ) : uploadedFileName ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            <p className="text-sm font-semibold">{uploadedFileName}</p>
            <p className="text-xs text-muted-foreground">File imported successfully</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              Choose different file
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
              <UploadCloud className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">Drag and drop Excel file</p>
            <p className="text-xs text-muted-foreground">or click to browse</p>
            <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              .xlsx, .xls
            </div>
          </div>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Upload error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
