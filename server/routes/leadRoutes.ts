import type { Express } from 'express';
import xlsx from 'xlsx';
import { ExcelRow } from '../../src/types';
import {
  claimUnknownEmailDeliveryForManualRetry,
  findEmailDeliveryById,
  listEmailDeliveriesForRow,
  markEmailDeliveryFailed,
  markEmailDeliverySent,
  markUnknownEmailDeliveryManuallyFailed,
  markUnknownEmailDeliveryManuallySent
} from '../emailDelivery';
import { listEmailLogsForRow } from '../emailLog';
import {
  ensureRequiredColumns,
  extractSheetInfo,
  friendlySheetsError,
  getSheetTitleByGid,
  updateGoogleSheetRow
} from '../googleSheets';
import { sendGmailTemplate } from '../googleAuth';
import { updateGoogleSheetRowsResilient } from '../googleSheets';
import { isValidLeadStatus, LEAD_STATUS, normalizeLeadStatus } from '../leadStatus';
import { resetDemoTestData } from '../adminDb';
import { applyDbTruthToRows, forceCloseActiveDemoForRow } from '../scheduleDb';
import {
  findSheetSyncJobById,
  listSheetSyncJobsForRow,
  markSheetSyncJobFailed,
  markSheetSyncJobRetryNow,
  markSheetSyncJobSucceeded
} from '../sheetSyncQueue';
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

  app.post('/api/admin/reset-demo-test-data', async (req, res) => {
    try {
      await resetDemoTestData();
      return res.json({ success: true });
    } catch (err: any) {
      console.error('Database reset failed:', err);
      return res.status(500).json({ error: err.message || 'Database reset failed' });
    }
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
      const dbRows = await applyDbTruthToRows(preparedRows);
      const result = await processLeadsByStatus(dbRows, {
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

      const [dbRow] = await applyDbTruthToRows([row]);
      if (dbRow.__dbFinalState) {
        return res.json({
          success: true,
          row: dbRow,
          skipped: true,
          message: dbRow.Remarks || 'Lead already finalized in database.'
        });
      }

      const result = await sendThankYouForRow(dbRow, {
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
        const [row] = await applyDbTruthToRows([rows[i]]);
        try {
          if (row.__dbFinalState) {
            results.push({
              id: row.id,
              success: true,
              row,
              skipped: true,
              message: row.Remarks || 'Lead already finalized in database.'
            });
            continue;
          }
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

  app.post('/api/active-demo/force-close', async (req, res) => {
    try {
      const { row, remarks, sourceType, spreadsheetId, sheetName, headers } = req.body as {
        row?: ExcelRow;
        remarks?: string;
        sourceType?: 'excel' | 'google-sheet';
        spreadsheetId?: string;
        sheetName?: string;
        headers?: string[];
      };

      if (!row) {
        return res.status(400).json({ error: 'Row is required.' });
      }

      const updatedRow = await forceCloseActiveDemoForRow(row, remarks);
      if (sourceType === 'google-sheet' && spreadsheetId && sheetName && headers?.length && row.__sheetRowNumber) {
        await updateGoogleSheetRow(spreadsheetId, sheetName, row.__sheetRowNumber, headers, {
          'Meeting Details': '',
          lead_status: String(updatedRow.lead_status || LEAD_STATUS.DEMO_SCHEDULED),
          Remarks: String(updatedRow.Remarks || '')
        });
      }

      return res.json({ success: true, row: updatedRow });
    } catch (err: any) {
      console.error('Force close active demo failed:', err);
      return res.status(500).json({ error: err.message || 'Force close active demo failed' });
    }
  });

  app.post('/api/email-deliveries/:deliveryId/mark-sent', async (req, res) => {
    try {
      const { deliveryId } = req.params;
      const { providerMessageId } = req.body as { providerMessageId?: string };
      const delivery = await findEmailDeliveryById(deliveryId);
      if (!delivery) return res.status(404).json({ error: 'Email delivery was not found.' });
      if (delivery.status !== 'UNKNOWN') {
        return res.status(400).json({ error: 'Only Needs Review email deliveries can be manually marked sent.' });
      }

      const updated = await markUnknownEmailDeliveryManuallySent({ deliveryId, providerMessageId });
      return res.json({ success: true, delivery: serializeDelivery(updated) });
    } catch (err: any) {
      console.error('Manual email sent review failed:', err);
      return res.status(500).json({ error: err.message || 'Manual email review failed' });
    }
  });

  app.post('/api/email-deliveries/:deliveryId/mark-failed', async (req, res) => {
    try {
      const { deliveryId } = req.params;
      const { reason } = req.body as { reason?: string };
      const delivery = await findEmailDeliveryById(deliveryId);
      if (!delivery) return res.status(404).json({ error: 'Email delivery was not found.' });
      if (delivery.status !== 'UNKNOWN') {
        return res.status(400).json({ error: 'Only Needs Review email deliveries can be manually marked failed.' });
      }

      const updated = await markUnknownEmailDeliveryManuallyFailed({ deliveryId, reason });
      return res.json({ success: true, delivery: serializeDelivery(updated) });
    } catch (err: any) {
      console.error('Manual email failed review failed:', err);
      return res.status(500).json({ error: err.message || 'Manual email review failed' });
    }
  });

  app.post('/api/email-deliveries/:deliveryId/retry', async (req, res) => {
    try {
      const { deliveryId } = req.params;
      const delivery = await findEmailDeliveryById(deliveryId);
      if (!delivery) return res.status(404).json({ error: 'Email delivery was not found.' });
      if (delivery.status !== 'UNKNOWN') {
        return res.status(400).json({ error: 'Only Needs Review email deliveries can be retried manually.' });
      }
      if (!delivery.subject || !delivery.textBody || !delivery.htmlBody) {
        return res.status(400).json({ error: 'Stored email payload is missing, so this delivery cannot be retried.' });
      }

      const claimed = await claimUnknownEmailDeliveryForManualRetry(deliveryId);
      if (!claimed) {
        return res.status(409).json({ error: 'This email delivery was already reviewed or claimed.' });
      }

      try {
        const result = await sendGmailTemplate(delivery.recipient, {
          subject: delivery.subject,
          text: delivery.textBody,
          html: delivery.htmlBody
        });
        await markEmailDeliverySent({ deliveryId, providerMessageId: result.messageId });
        const updated = await findEmailDeliveryById(deliveryId);
        return res.json({ success: true, delivery: serializeDelivery(updated) });
      } catch (error) {
        const classification = await markEmailDeliveryFailed({ deliveryId, error });
        const updated = await findEmailDeliveryById(deliveryId);
        return res.status(502).json({
          error: error instanceof Error ? error.message : 'Manual retry failed',
          classification,
          delivery: serializeDelivery(updated)
        });
      }
    } catch (err: any) {
      console.error('Manual email retry failed:', err);
      return res.status(500).json({ error: err.message || 'Manual email retry failed' });
    }
  });

  app.post('/api/sheet-sync/jobs-for-row', async (req, res) => {
    try {
      const { row } = req.body as { row?: ExcelRow };
      if (!row) return res.status(400).json({ error: 'Row is required.' });
      const spreadsheetId = String(row.__spreadsheetId || '');
      const sheetName = String(row.__sheetName || '');
      const rowNumber = Number(row.__sheetRowNumber || row.__sourceRowNumber);
      if (!spreadsheetId || !sheetName || !rowNumber) {
        return res.json({ jobs: [] });
      }

      const jobs = await listSheetSyncJobsForRow({ spreadsheetId, sheetName, rowNumber });
      return res.json({ jobs: jobs.map(serializeSheetSyncJob) });
    } catch (err: any) {
      console.error('Sheet sync job lookup failed:', err);
      return res.status(500).json({ error: err.message || 'Sheet sync job lookup failed' });
    }
  });

  app.post('/api/sheet-sync/jobs/:jobId/retry', async (req, res) => {
    try {
      const { jobId } = req.params;
      const job = await findSheetSyncJobById(jobId);
      if (!job) return res.status(404).json({ error: 'Sheet sync job was not found.' });
      if (job.status === 'SYNCED') {
        return res.json({ success: true, job: serializeSheetSyncJob(job), skipped: true });
      }

      await markSheetSyncJobRetryNow(jobId);

      try {
        const headers = JSON.parse(job.headersJson) as string[];
        const values = JSON.parse(job.valuesJson) as Record<string, any>;
        const [result] = await updateGoogleSheetRowsResilient(
          job.spreadsheetId,
          job.sheetName,
          headers,
          [{ rowNumber: job.rowNumber, values, emailDeliveryId: job.emailDeliveryId || undefined }]
        );

        if (!result?.success) {
          throw new Error(result?.error || 'Google Sheet row update failed');
        }

        await markSheetSyncJobSucceeded(jobId);
        const updated = await findSheetSyncJobById(jobId);
        return res.json({ success: true, job: serializeSheetSyncJob(updated) });
      } catch (error) {
        await markSheetSyncJobFailed(jobId, error);
        const updated = await findSheetSyncJobById(jobId);
        return res.status(502).json({
          error: error instanceof Error ? error.message : 'Sheet sync retry failed',
          job: serializeSheetSyncJob(updated)
        });
      }
    } catch (err: any) {
      console.error('Sheet sync retry failed:', err);
      return res.status(500).json({ error: err.message || 'Sheet sync retry failed' });
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

      const dbRows = await applyDbTruthToRows(rows);
      const plan = await buildProcessLeadPlan(dbRows);
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

      const dbRows = await applyDbTruthToRows(rows);
      const result = await processLeadsByStatus(dbRows, {
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

function serializeDelivery(delivery: Awaited<ReturnType<typeof findEmailDeliveryById>>) {
  if (!delivery) return null;
  return {
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
  };
}

function serializeSheetSyncJob(job: Awaited<ReturnType<typeof findSheetSyncJobById>>) {
  if (!job) return null;
  return {
    id: job.id,
    spreadsheetId: job.spreadsheetId,
    sheetName: job.sheetName,
    rowNumber: job.rowNumber,
    status: job.status,
    retryCount: job.retryCount,
    maxRetries: job.maxRetries,
    nextRetryAt: job.nextRetryAt,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}
