import { ExcelRow } from '../../src/types';
import { ensureRequiredColumns, ensureSheetAutomationIds, readSheetRows } from '../googleSheets';
import { buildProcessLeadPlan } from '../leadWorkflow';

export function createSheetSyncService() {
  const sheetProcessingLocks = new Set<string>();

  return {
    async runSheetSync(spreadsheetId: string, sheetName: string, incomingHeaders?: string[]) {
      const lockKey = `${spreadsheetId}|${sheetName}`;
      if (sheetProcessingLocks.has(lockKey)) {
        const freshRows = await readSheetRows(spreadsheetId, sheetName);
        const { headers } = await ensureRequiredColumns(
          spreadsheetId,
          sheetName,
          incomingHeaders?.length ? incomingHeaders : freshRows.headers
        );
        return {
          skippedDueToLock: true,
          rows: freshRows.rows.map((row) => ({ ...row, __originalColumns: headers })),
          headers,
          summary: {
            total: freshRows.rows.length,
            demoScheduled: 0,
            reschedule: 0,
            demoDone: 0,
            statusOnly: 0,
            invalid: 0,
            failed: 0,
            skipped: freshRows.rows.length,
            timeConflicts: 0
          },
          groups: {
            demoScheduledRows: [] as ExcelRow[],
            rescheduleRows: [] as ExcelRow[],
            demoDoneRows: [] as ExcelRow[],
            statusOnlyRows: [] as ExcelRow[],
            invalidRows: [] as ExcelRow[],
            skippedRows: freshRows.rows
          }
        };
      }

      sheetProcessingLocks.add(lockKey);
      try {
        const sheetData = await readSheetRows(spreadsheetId, sheetName);
        const { headers } = await ensureRequiredColumns(
          spreadsheetId,
          sheetName,
          incomingHeaders?.length ? incomingHeaders : sheetData.headers
        );
        const rowsWithAutomationIds = await ensureSheetAutomationIds(
          spreadsheetId,
          sheetName,
          headers,
          sheetData.rows
        );
        const rows = rowsWithAutomationIds.map((row) => ({
          ...row,
          __originalColumns: headers,
          __spreadsheetId: spreadsheetId,
          __sheetName: sheetName
        }));
        const plan = await buildProcessLeadPlan(rows);
        return {
          rows,
          headers,
          skippedDueToLock: false,
          summary: {
            total: plan.summary.total,
            demoScheduled: plan.summary.demoScheduled,
            reschedule: plan.summary.reschedule,
            demoDone: plan.summary.demoDone,
            statusOnly: plan.summary.statusOnly,
            invalid: plan.summary.invalid,
            failed: plan.summary.invalid,
            skipped: plan.summary.skipped,
            timeConflicts: plan.summary.timeConflicts
          },
          groups: {
            demoScheduledRows: plan.demoScheduledRows,
            rescheduleRows: plan.rescheduleRows,
            demoDoneRows: plan.demoDoneRows,
            statusOnlyRows: plan.statusOnlyRows,
            invalidRows: plan.invalidRows.map((item) => item.row),
            skippedRows: plan.skippedRows.map((item) => item.row)
          }
        };
      } finally {
        sheetProcessingLocks.delete(lockKey);
      }
    }
  };
}
