import { ExcelRow } from '../../src/types';

/** Shared job payload for future BullMQ row scheduling workers. */
export type SchedulerJobPayload = {
  row: ExcelRow;
  spreadsheetId?: string;
  sheetName?: string;
  headers?: string[];
  sourceType: 'excel' | 'google-sheet';
  batchId?: string;
};

export type SchedulerJobResult = {
  rowId: string;
  status: 'Scheduled' | 'Failed' | 'Skipped';
  remarks?: string;
};
