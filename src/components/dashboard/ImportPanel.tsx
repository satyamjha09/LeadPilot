import { FileSpreadsheet, Link2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ExcelUpload from '@/src/components/import/ExcelUpload';
import GoogleSheetImport from '@/src/components/import/GoogleSheetImport';
import { ExcelRow, SheetSource } from '@/src/types';

interface ImportPanelProps {
  onExcelParsed: (rows: ExcelRow[]) => void | Promise<void>;
  onGoogleSheetParsed: (rows: ExcelRow[], source: SheetSource) => void | Promise<void>;
  emailBrand: 'tallykonnect' | 'anywheretally';
  isLoading: boolean;
  setIsLoading: (val: boolean) => void;
  uploadedFileName: string | null;
  setUploadedFileName: (name: string | null) => void;
  defaultTab?: 'excel' | 'google-sheet';
}

export default function ImportPanel({
  onExcelParsed,
  onGoogleSheetParsed,
  emailBrand,
  isLoading,
  setIsLoading,
  uploadedFileName,
  setUploadedFileName,
  defaultTab = 'excel'
}: ImportPanelProps) {
  return (
    <Card id="import-panel" className="tk-hover-card">
      <CardHeader>
        <CardTitle className="text-lg">Import Leads</CardTitle>
        <CardDescription>
          Upload an Excel workbook or paste a Google Sheet URL to load leads into the dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
            <ExcelUpload
              onDataParsed={onExcelParsed}
              isLoading={isLoading}
              setIsLoading={setIsLoading}
              uploadedFileName={uploadedFileName}
              setUploadedFileName={setUploadedFileName}
            />
          </TabsContent>
          <TabsContent value="google-sheet" className="mt-4">
            <GoogleSheetImport
              onDataParsed={onGoogleSheetParsed}
              emailBrand={emailBrand}
              isLoading={isLoading}
              setIsLoading={setIsLoading}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
