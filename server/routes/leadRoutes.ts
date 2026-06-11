import type { Express } from 'express';
import xlsx from 'xlsx';
import { ExcelRow } from '../../src/types';
import { listEmailDeliveriesForRow } from '../emailDelivery';
import { listEmailLogsForRow } from '../emailLog';
import { ensureRequiredColumns, extractSheetInfo, friendlySheetsError, getSheetTitleByGid } from '../googleSheets';
import { isValidLeadStatus, LEAD_STATUS, normalizeLeadStatus } from '../leadStatus';
import {
  buildProcessLeadPlan,
  processLeadsByStatus,
  processScheduleRows,
  sendThankYouForRow,
  updateLeadStatusOnly
} from '../leadWorkflow';
import { buildExportRow, normalizeRows, reconcileScheduledRows } from '../services/rowTransforms';

type SheetSyncRunner = (
  spreadsheetId: string,
  sheetName: string,
  incomingHeaders?: string[]
) => Promise<any>;

export function registerLeadRoutes(app: Express, options: { runSheetSync: SheetSyncRunner }) {
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.post('/api/preview', (req, res) => {
    try {
      const { fileData } = req.body;
      if (!fileData) {
        return res.status(400).json({ error: 'No Excel file data supplied.' });
      }

      const buffer = Buffer.from(fileData, 'base64');
      const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json<any>(sheet);

      return res.json({ rows: normalizeRows(rows, { idPrefix: 'excel' }) });
    } catch (err: any) {
      console.error('Failed to parse Excel file:', err);
      return res.status(500).json({ error: `Parsing failed: ${err.message}` });
    }
  });

  app.post('/api/sheets/import', async (req, res) => {
    try {
      const { sheetUrl } = req.body as { sheetUrl?: string };
      if (!sheetUrl) {
        return res.status(400).json({ error: 'Google Sheet URL is required.' });
      }

      const { spreadsheetId, gid } = extractSheetInfo(sheetUrl);
      const sheetName = await getSheetTitleByGid(spreadsheetId, gid);
      const syncResult = await options.runSheetSync(spreadsheetId, sheetName);

      return res.json({
        source: 'google-sheet',
        spreadsheetId,
        gid,
        sheetName,
        rows: syncResult.rows,
        headers: syncResult.headers,
        summary: syncResult.summary,
        groups: syncResult.groups,
        skippedDueToLock: syncResult.skippedDueToLock
      });
    } catch (err: any) {
      console.error('Google Sheets import failed:', err);
      const friendlyError = friendlySheetsError(err);
      return res.status(friendlyError.status).json({ error: friendlyError.message });
    }
  });

  app.post('/api/sheets/sync', async (req, res) => {
    try {
      const { spreadsheetId, sheetName, headers: incomingHeaders } = req.body as {
        spreadsheetId?: string;
        sheetName?: string;
        headers?: string[];
      };

      if (!spreadsheetId || !sheetName) {
        return res.status(400).json({ error: 'spreadsheetId and sheetName are required.' });
      }

      const result = await options.runSheetSync(spreadsheetId, sheetName, incomingHeaders);
      return res.json(result);
    } catch (err: any) {
      console.error('Google Sheets sync failed:', err);
      const friendlyError = friendlySheetsError(err);
      return res.status(friendlyError.status).json({ error: friendlyError.message });
    }
  });

  app.post('/api/schedule', async (req, res) => {
    try {
      const { rows } = req.body as { rows: ExcelRow[] };
      if (!rows || !Array.isArray(rows)) {
        return res.status(400).json({ error: 'Valid rows list must be supplied.' });
      }

      console.log(`Received request to schedule ${rows.length} rows...`);
      const { rows: results, summary } = await processScheduleRows(rows);
      return res.json({ rows: results, summary });
    } catch (err: any) {
      console.error('Schedule batch failed:', err);
      return res.status(500).json({ error: `Batch processing crashed: ${err.message}` });
    }
  });

  app.post('/api/sheets/schedule', async (req, res) => {
    try {
      const { spreadsheetId, sheetName, headers: incomingHeaders, rows } = req.body as {
        spreadsheetId?: string;
        sheetName?: string;
        headers?: string[];
        rows?: ExcelRow[];
      };

      if (!spreadsheetId || !sheetName) {
        return res.status(400).json({ error: 'spreadsheetId and sheetName are required.' });
      }
      if (!rows || !Array.isArray(rows)) {
        return res.status(400).json({ error: 'Valid rows list must be supplied.' });
      }
      if (!incomingHeaders || !Array.isArray(incomingHeaders) || incomingHeaders.length === 0) {
        return res.status(400).json({ error: 'Google Sheet headers are required.' });
      }

      console.log(`Received request to schedule ${rows.length} Google Sheet rows...`);
      const { headers } = await ensureRequiredColumns(spreadsheetId, sheetName, incomingHeaders);
      const preparedRows = rows.map((row) => ({
        ...row,
        __sourceType: 'google-sheet' as const,
        __spreadsheetId: spreadsheetId,
        __sheetName: sheetName,
        __originalColumns: headers
      }));
      const result = await processLeadsByStatus(preparedRows, {
        sourceType: 'google-sheet',
        spreadsheetId,
        sheetName,
        headers
      });

      return res.json({ ...result, headers });
    } catch (err: any) {
      console.error('Google Sheets schedule failed:', err);
      const friendlyError = friendlySheetsError(err);
      return res.status(friendlyError.status).json({ error: friendlyError.message });
    }
  });

  app.post('/api/send-thank-you', async (req, res) => {
    try {
      const { row, sourceType, spreadsheetId, sheetName, headers } = req.body as {
        row?: ExcelRow;
        sourceType?: 'excel' | 'google-sheet';
        spreadsheetId?: string;
        sheetName?: string;
        headers?: string[];
      };
      if (!row) return res.status(400).json({ error: 'Row is required.' });

      const result = await sendThankYouForRow(row, {
        sourceType: sourceType || 'excel',
        spreadsheetId,
        sheetName,
        headers
      });

      return res.json({
        success: true,
        row: result.row,
        skipped: result.skipped,
        message: result.message
      });
    } catch (err: any) {
      console.error('Thank-you email failed:', err);
      return res.status(500).json({ error: err.message || 'Thank-you email failed' });
    }
  });

  app.post('/api/send-thank-you/batch', async (req, res) => {
    try {
      const { rows, sourceType, spreadsheetId, sheetName, headers } = req.body as {
        rows?: ExcelRow[];
        sourceType?: 'excel' | 'google-sheet';
        spreadsheetId?: string;
        sheetName?: string;
        headers?: string[];
      };
      if (!rows || !Array.isArray(rows)) {
        return res.status(400).json({ error: 'Valid rows list must be supplied.' });
      }

      const context = {
        sourceType: (sourceType || 'excel') as 'excel' | 'google-sheet',
        spreadsheetId,
        sheetName,
        headers
      };

      const results: Array<{
        id: string;
        success: boolean;
        row?: ExcelRow;
        skipped?: boolean;
        message?: string;
        error?: string;
      }> = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const result = await sendThankYouForRow(row, context);
          results.push({
            id: row.id,
            success: true,
            row: result.row,
            skipped: result.skipped,
            message: result.message
          });
        } catch (err: any) {
          results.push({
            id: row.id,
            success: false,
            error: err.message || 'Thank-you email failed',
            row
          });
        }
        if (i < rows.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      return res.json({ results });
    } catch (err: any) {
      console.error('Thank-you batch failed:', err);
      return res.status(500).json({ error: err.message || 'Thank-you batch failed' });
    }
  });

  app.post('/api/lead-status/update', async (req, res) => {
    try {
      const { row, status, remarks, sourceType, spreadsheetId, sheetName, headers } = req.body as {
        row?: ExcelRow;
        status?: string;
        remarks?: string;
        sourceType?: 'excel' | 'google-sheet';
        spreadsheetId?: string;
        sheetName?: string;
        headers?: string[];
      };

      if (!row || !status) {
        return res.status(400).json({ error: 'Row and status are required.' });
      }

      const normalized = normalizeLeadStatus(status);
      if (normalized === LEAD_STATUS.DEMO_SCHEDULED) {
        return res.status(400).json({ error: 'Use scheduling endpoint for Demo Scheduled' });
      }
      if (normalized === LEAD_STATUS.DEMO_DONE) {
        return res.status(400).json({ error: 'Use thank-you endpoint for Demo Done' });
      }
      if (normalized === LEAD_STATUS.RESCHEDULE) {
        return res.status(400).json({ error: 'Use lead processing endpoint for Reschedule' });
      }
      if (normalized === LEAD_STATUS.NO_RESPONSE) {
        return res.status(400).json({ error: 'Use lead processing endpoint for No Response' });
      }
      if (!isValidLeadStatus(status)) {
        return res.status(400).json({ error: 'Invalid lead_status value.' });
      }

      const updatedRow = await updateLeadStatusOnly(
        row,
        status,
        {
          sourceType: sourceType || 'excel',
          spreadsheetId,
          sheetName,
          headers
        },
        remarks
      );

      return res.json({ success: true, row: updatedRow });
    } catch (err: any) {
      console.error('Lead status update failed:', err);
      return res.status(500).json({ error: err.message || 'Lead status update failed' });
    }
  });

  app.post('/api/leads/email-history', async (req, res) => {
    try {
      const { row } = req.body as { row?: ExcelRow };
      if (!row) return res.status(400).json({ error: 'Row is required.' });

      const sourceType = row.__sourceType === 'google-sheet' ? 'google-sheet' : 'excel';
      const [logs, deliveries] = await Promise.all([
        listEmailLogsForRow(row),
        listEmailDeliveriesForRow(row, {
          sourceType,
          spreadsheetId: row.__spreadsheetId,
          sheetName: row.__sheetName
        })
      ]);

      const history = [
        ...deliveries.map((delivery) => ({
          id: delivery.id,
          source: 'EmailDelivery',
          type: delivery.emailType,
          status: delivery.status,
          recipient: delivery.recipient,
          messageId: delivery.providerMessageId,
          error: delivery.lastError,
          sentAt: delivery.sentAt,
          createdAt: delivery.createdAt,
          updatedAt: delivery.updatedAt,
          attemptCount: delivery.attemptCount
        })),
        ...logs.map((log) => ({
          id: log.id,
          source: 'EmailLog',
          type: log.type,
          status: log.status,
          recipient: log.email,
          messageId: log.messageId,
          error: log.error,
          sentAt: log.status === 'sent' ? log.createdAt : null,
          createdAt: log.createdAt,
          updatedAt: log.createdAt,
          attemptCount: undefined
        }))
      ].sort((a, b) => {
        const aTime = new Date(a.sentAt || a.updatedAt || a.createdAt).getTime();
        const bTime = new Date(b.sentAt || b.updatedAt || b.createdAt).getTime();
        return bTime - aTime;
      });

      return res.json({
        logs: history
      });
    } catch (err: any) {
      console.error('Email history lookup failed:', err);
      return res.status(500).json({ error: err.message || 'Email history lookup failed' });
    }
  });

  app.post('/api/process-leads/preview', async (req, res) => {
    try {
      const { rows } = req.body as { rows?: ExcelRow[] };
      if (!rows || !Array.isArray(rows)) {
        return res.status(400).json({ error: 'Valid rows list must be supplied.' });
      }

      const plan = await buildProcessLeadPlan(rows);
      const flattenPlannedRows = (items: any[]) =>
        items.map((item) => ({
          ...(item.row || item),
          reason: item.reason || '',
          Remarks: item.row?.Remarks || item.reason || item.Remarks || ''
        }));
      return res.json({
        summary: plan.summary,
        timeConflictGroups: plan.timeConflictGroups.map((group) => ({
          key: group.key,
          date: group.date,
          time: group.time,
          count: group.count,
          names: group.names
        })),
        estimatedTime: plan.estimatedTime,
        meetingRecipients: plan.meetingRecipients.slice(0, 5),
        thankYouRecipients: plan.thankYouRecipients.slice(0, 5),
        noResponseRecipients: plan.noResponseRecipients.slice(0, 5),
        groups: {
          demoScheduledRows: plan.demoScheduledRows,
          rescheduleRows: plan.rescheduleRows,
          demoDoneRows: plan.demoDoneRows,
          statusOnlyRows: plan.statusOnlyRows,
          invalidRows: flattenPlannedRows(plan.invalidRows),
          skippedRows: flattenPlannedRows(plan.skippedRows)
        }
      });
    } catch (err: any) {
      console.error('Lead process preview failed:', err);
      return res.status(500).json({ error: err.message || 'Lead process preview failed' });
    }
  });

  app.post('/api/process-leads', async (req, res) => {
    try {
      const { rows, sourceType, spreadsheetId, sheetName, headers: incomingHeaders } = req.body as {
        rows?: ExcelRow[];
        sourceType?: 'excel' | 'google-sheet';
        spreadsheetId?: string;
        sheetName?: string;
        headers?: string[];
      };

      if (!rows || !Array.isArray(rows)) {
        return res.status(400).json({ error: 'Valid rows list must be supplied.' });
      }

      let headers = incomingHeaders || [];
      if (sourceType === 'google-sheet') {
        if (!spreadsheetId || !sheetName) {
          return res.status(400).json({ error: 'spreadsheetId and sheetName are required.' });
        }
        if (!headers.length) {
          return res.status(400).json({ error: 'Google Sheet headers are required.' });
        }
        const ensured = await ensureRequiredColumns(spreadsheetId, sheetName, headers);
        headers = ensured.headers;
      }

      const result = await processLeadsByStatus(rows, {
        sourceType: sourceType || 'excel',
        spreadsheetId,
        sheetName,
        headers
      });

      return res.json({ ...result, headers });
    } catch (err: any) {
      console.error('Lead processing failed:', err);
      const friendlyError = friendlySheetsError(err);
      if (req.body?.sourceType === 'google-sheet') {
        return res.status(friendlyError.status).json({ error: friendlyError.message });
      }
      return res.status(500).json({ error: err.message || 'Lead processing failed' });
    }
  });

  app.post('/api/reconcile', async (req, res) => {
    try {
      const { rows } = req.body as { rows: ExcelRow[] };
      if (!rows || !Array.isArray(rows)) {
        return res.status(400).json({ error: 'Valid rows list must be supplied.' });
      }

      return res.json({ rows: await reconcileScheduledRows(rows) });
    } catch (err: any) {
      console.error('Reconcile failed:', err);
      return res.status(500).json({ error: `Reconcile failed: ${err.message}` });
    }
  });

  app.post('/api/export', (req, res) => {
    try {
      const { rows } = req.body as { rows: ExcelRow[] };
      if (!rows || !Array.isArray(rows)) {
        return res.status(400).json({ error: 'Rows list is required to export.' });
      }

      const cleanedData = rows.map(buildExportRow);

      const ws = xlsx.utils.json_to_sheet(cleanedData);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Demo Schedules');

      const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const base64Data = buf.toString('base64');

      return res.json({
        filename: 'Excel_Meet_Schedules_Updated.xlsx',
        fileData: base64Data
      });
    } catch (err: any) {
      console.error('Excel Export failed:', err);
      return res.status(500).json({ error: `Export aborted: ${err.message}` });
    }
  });
}
