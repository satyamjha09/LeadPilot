import { timingSafeEqual } from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import multer from 'multer';
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
import { assertProcessBatchBrandOwnership } from '../lifecycleOwnership';
import {
  createProcessLeadJob,
  getProcessLeadJob,
  serializeProcessLeadJob
} from '../processLeadJobs';
import { enqueueProcessLeadJob, isProcessQueueEnabled, prepareProcessQueueForReset } from '../processLeadQueue';
import { buildExportRow, normalizeRows, reconcileScheduledRows } from '../services/rowTransforms';
import { sendRouteError } from '../routeErrors';
import { coerceStoredEmailBrand, parseEmailBrand, type EmailBrandKey } from '../../src/lib/emailBrand';
import { beginResetGuard, withWorkflowActivity } from '../workflowActivity';
import {
  advanceWorkflowGenerationForReset,
  beginWorkflowResetWindow,
  finishWorkflowResetWindow
} from '../workflowControl';

type SheetSyncRunner = (
  spreadsheetId: string,
  sheetName: string,
  incomingHeaders: string[] | undefined,
  emailBrand: EmailBrandKey
) => Promise<any>;

function getProvidedAdminResetToken(req: Request) {
  return String(
    req.get('x-admin-reset-token') ||
    (req.body as { adminResetToken?: string } | undefined)?.adminResetToken ||
    ''
  ).trim();
}

function adminTokensMatch(configuredToken: string, providedToken: string) {
  if (!configuredToken || !providedToken) return false;
  const configured = Buffer.from(configuredToken);
  const provided = Buffer.from(providedToken);
  return configured.length === provided.length && timingSafeEqual(configured, provided);
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const configuredToken = String(process.env.ADMIN_RESET_TOKEN || '').trim();
  if (!configuredToken) {
    console.error('ADMIN_RESET_TOKEN is required before reset workflow can be used.');
    return res.status(503).json({ error: 'Admin reset is not configured.' });
  }

  if (!adminTokensMatch(configuredToken, getProvidedAdminResetToken(req))) {
    return res.status(403).json({ error: 'Invalid admin reset key.' });
  }

  return next();
}

async function resetDemoDataHandler(_req: Request, res: Response) {
  let resumeQueue: (() => Promise<void>) | null = null;
  let finishResetGuard: (() => void) | null = null;
  let workflowResetWindowStarted = false;

  try {
    finishResetGuard = beginResetGuard();
    await beginWorkflowResetWindow();
    workflowResetWindowStarted = true;
    resumeQueue = await prepareProcessQueueForReset();
    await advanceWorkflowGenerationForReset();
    await resetDemoTestData();
    return res.json({ success: true, message: 'Workflow database and pending process jobs cleared.' });
  } catch (err: any) {
    console.error('Database reset failed:', err);
    return sendRouteError(res, err, 'Database reset failed');
  } finally {
    if (finishResetGuard) {
      finishResetGuard();
    }
    if (workflowResetWindowStarted) {
      await finishWorkflowResetWindow().catch((error) => {
        console.error('Could not finish workflow reset window:', error);
      });
    }
    if (resumeQueue) {
      await resumeQueue().catch((error) => {
        console.error('Could not resume process queue:', error);
      });
    }
  }
}

export function registerLeadRoutes(app: Express, options: { runSheetSync: SheetSyncRunner }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.post('/api/admin/reset-demo-test-data', requireAdmin, resetDemoDataHandler);

  app.post('/api/preview', upload.single('file'), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No Excel file supplied.' });
      }

      const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
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
      return await withWorkflowActivity('sheet-sync', async () => {
        const { sheetUrl, emailBrand } = req.body as { sheetUrl?: string; emailBrand?: any };
        const brand = parseEmailBrand(emailBrand);
        if (!sheetUrl) {
          return res.status(400).json({ error: 'Google Sheet URL is required.' });
        }

        const { spreadsheetId, gid } = extractSheetInfo(sheetUrl);
        const sheetName = await getSheetTitleByGid(spreadsheetId, gid, brand);
        const syncResult = await options.runSheetSync(spreadsheetId, sheetName, undefined, brand);

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
      });
    } catch (err: any) {
      console.error('Google Sheets import failed:', err);
      if (err.statusCode) {
        return sendRouteError(res, err, 'Google Sheets import failed');
      }
      const friendlyError = friendlySheetsError(err);
      return res.status(friendlyError.status).json({ error: friendlyError.message });
    }
  });

  app.post('/api/sheets/sync', async (req, res) => {
    try {
      return await withWorkflowActivity('sheet-sync', async () => {
        const { spreadsheetId, sheetName, headers: incomingHeaders, emailBrand } = req.body as {
          spreadsheetId?: string;
          sheetName?: string;
          headers?: string[];
          emailBrand?: any;
        };
        const brand = parseEmailBrand(emailBrand);

        if (!spreadsheetId || !sheetName) {
          return res.status(400).json({ error: 'spreadsheetId and sheetName are required.' });
        }

        const result = await options.runSheetSync(spreadsheetId, sheetName, incomingHeaders, brand);
        return res.json(result);
      });
    } catch (err: any) {
      console.error('Google Sheets sync failed:', err);
      if (err.statusCode) {
        return sendRouteError(res, err, 'Google Sheets sync failed');
      }
      const friendlyError = friendlySheetsError(err);
      return res.status(friendlyError.status).json({ error: friendlyError.message });
    }
  });

  app.post('/api/schedule', async (req, res) => {
    try {
      return await withWorkflowActivity('lead-processing', async () => {
        const { rows, emailBrand } = req.body as { rows: ExcelRow[]; emailBrand?: any };
        const brand = parseEmailBrand(emailBrand);
        if (!rows || !Array.isArray(rows)) {
          return res.status(400).json({ error: 'Valid rows list must be supplied.' });
        }

        console.log(`Received request to schedule ${rows.length} rows...`);
        const { rows: results, summary } = await processScheduleRows(rows, {
          sheetContext: {
            sourceType: 'excel',
            emailBrand: brand
          }
        });
        return res.json({ rows: results, summary });
      });
    } catch (err: any) {
      console.error('Schedule batch failed:', err);
      return sendRouteError(res, err, `Batch processing crashed: ${err.message}`);
    }
  });

  app.post('/api/sheets/schedule', async (req, res) => {
    try {
      return await withWorkflowActivity('lead-processing', async () => {
        const { spreadsheetId, sheetName, headers: incomingHeaders, rows, emailBrand } = req.body as {
          spreadsheetId?: string;
          sheetName?: string;
          headers?: string[];
          rows?: ExcelRow[];
          emailBrand?: any;
        };
        const brand = parseEmailBrand(emailBrand);

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
        const { headers } = await ensureRequiredColumns(spreadsheetId, sheetName, incomingHeaders, brand);
        const preparedRows = rows.map((row) => ({
          ...row,
          __sourceType: 'google-sheet' as const,
          __spreadsheetId: spreadsheetId,
          __sheetName: sheetName,
          __originalColumns: headers
        }));
        const dbRows = await applyDbTruthToRows(preparedRows, brand);
        const result = await processLeadsByStatus(dbRows, {
          sourceType: 'google-sheet',
          spreadsheetId,
          sheetName,
          headers,
          emailBrand: brand
        });

        return res.json({ ...result, headers });
      });
    } catch (err: any) {
      console.error('Google Sheets schedule failed:', err);
      if (err.statusCode) {
        return sendRouteError(res, err, 'Google Sheets schedule failed');
      }
      const friendlyError = friendlySheetsError(err);
      return res.status(friendlyError.status).json({ error: friendlyError.message });
    }
  });

  app.post('/api/send-thank-you', async (req, res) => {
    try {
      return await withWorkflowActivity('lead-processing', async () => {
        const { row, sourceType, spreadsheetId, sheetName, headers, emailBrand } = req.body as {
          row?: ExcelRow;
          sourceType?: 'excel' | 'google-sheet';
          spreadsheetId?: string;
          sheetName?: string;
          headers?: string[];
          emailBrand?: any;
        };
        const brand = parseEmailBrand(emailBrand);
        if (!row) return res.status(400).json({ error: 'Row is required.' });

        const [dbRow] = await applyDbTruthToRows([row], brand);
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
          headers,
          emailBrand: brand
        });

        return res.json({
          success: true,
          row: result.row,
          skipped: result.skipped,
          message: result.message
        });
      });
    } catch (err: any) {
      console.error('Thank-you email failed:', err);
      return sendRouteError(res, err, 'Thank-you email failed');
    }
  });

  app.post('/api/send-thank-you/batch', async (req, res) => {
    try {
      return await withWorkflowActivity('lead-processing', async () => {
        const { rows, sourceType, spreadsheetId, sheetName, headers, emailBrand } = req.body as {
          rows?: ExcelRow[];
          sourceType?: 'excel' | 'google-sheet';
          spreadsheetId?: string;
          sheetName?: string;
          headers?: string[];
          emailBrand?: any;
        };
        const brand = parseEmailBrand(emailBrand);
        if (!rows || !Array.isArray(rows)) {
          return res.status(400).json({ error: 'Valid rows list must be supplied.' });
        }

        const context = {
          sourceType: (sourceType || 'excel') as 'excel' | 'google-sheet',
          spreadsheetId,
          sheetName,
          headers,
          emailBrand: brand
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
          const [row] = await applyDbTruthToRows([rows[i]], brand);
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
      });
    } catch (err: any) {
      console.error('Thank-you batch failed:', err);
      return sendRouteError(res, err, 'Thank-you batch failed');
    }
  });

  app.post('/api/lead-status/update', async (req, res) => {
    try {
      return await withWorkflowActivity('lead-processing', async () => {
        const { row, status, remarks, sourceType, spreadsheetId, sheetName, headers, emailBrand } = req.body as {
          row?: ExcelRow;
          status?: string;
          remarks?: string;
          sourceType?: 'excel' | 'google-sheet';
          spreadsheetId?: string;
          sheetName?: string;
          headers?: string[];
          emailBrand?: any;
        };
        const brand = parseEmailBrand(emailBrand);

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
          return res.status(400).json({ error: 'Use lead processing endpoint for Not Attended' });
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
            headers,
            emailBrand: brand
          },
          remarks
        );

        return res.json({ success: true, row: updatedRow });
      });
    } catch (err: any) {
      console.error('Lead status update failed:', err);
      return sendRouteError(res, err, 'Lead status update failed');
    }
  });

  app.post('/api/active-demo/force-close', async (req, res) => {
    try {
      return await withWorkflowActivity('lead-processing', async () => {
        const { row, remarks, sourceType, spreadsheetId, sheetName, headers, emailBrand } = req.body as {
          row?: ExcelRow;
          remarks?: string;
          sourceType?: 'excel' | 'google-sheet';
          spreadsheetId?: string;
          sheetName?: string;
          headers?: string[];
          emailBrand?: any;
        };
        const brand = parseEmailBrand(emailBrand);

        if (!row) {
          return res.status(400).json({ error: 'Row is required.' });
        }

        const updatedRow = await forceCloseActiveDemoForRow(row, remarks, brand);
        if (sourceType === 'google-sheet' && spreadsheetId && sheetName && headers?.length && row.__sheetRowNumber) {
          await updateGoogleSheetRow(spreadsheetId, sheetName, row.__sheetRowNumber, headers, {
            'Meeting Details': '',
            lead_status: String(updatedRow.lead_status || LEAD_STATUS.DEMO_SCHEDULED),
            Remarks: String(updatedRow.Remarks || '')
          }, brand);
        }

        return res.json({ success: true, row: updatedRow });
      });
    } catch (err: any) {
      console.error('Force close active demo failed:', err);
      return sendRouteError(res, err, 'Force close active demo failed');
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
      return await withWorkflowActivity('lead-processing', async () => {
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
          }, delivery.emailBrand);
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
      });
    } catch (err: any) {
      console.error('Manual email retry failed:', err);
      return sendRouteError(res, err, 'Manual email retry failed');
    }
  });

  app.post('/api/sheet-sync/jobs-for-row', async (req, res) => {
    try {
      const { row, emailBrand } = req.body as { row?: ExcelRow; emailBrand?: any };
      if (!row) return res.status(400).json({ error: 'Row is required.' });
      const brand = row.__emailBrand
        ? coerceStoredEmailBrand(row.__emailBrand)
        : parseEmailBrand(emailBrand);
      const spreadsheetId = String(row.__spreadsheetId || '');
      const sheetName = String(row.__sheetName || '');
      const rowNumber = Number(row.__sheetRowNumber || row.__sourceRowNumber);
      if (!spreadsheetId || !sheetName || !rowNumber) {
        return res.json({ jobs: [] });
      }

      const jobs = await listSheetSyncJobsForRow({ emailBrand: brand, spreadsheetId, sheetName, rowNumber });
      return res.json({ jobs: jobs.map(serializeSheetSyncJob) });
    } catch (err: any) {
      console.error('Sheet sync job lookup failed:', err);
      return sendRouteError(res, err, 'Sheet sync job lookup failed');
    }
  });

  app.post('/api/sheet-sync/jobs/:jobId/retry', async (req, res) => {
    try {
      return await withWorkflowActivity('sheet-sync', async () => {
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
            [{ rowNumber: job.rowNumber, values, emailDeliveryId: job.emailDeliveryId || undefined }],
            {},
            job.emailBrand
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
      });
    } catch (err: any) {
      console.error('Sheet sync retry failed:', err);
      return sendRouteError(res, err, 'Sheet sync retry failed');
    }
  });

  app.post('/api/leads/email-history', async (req, res) => {
    try {
      const { row, emailBrand } = req.body as { row?: ExcelRow; emailBrand?: any };
      if (!row) return res.status(400).json({ error: 'Row is required.' });
      const brand = row.__emailBrand
        ? coerceStoredEmailBrand(row.__emailBrand)
        : parseEmailBrand(emailBrand);

      const sourceType = row.__sourceType === 'google-sheet' ? 'google-sheet' : 'excel';
      const [logs, deliveries] = await Promise.all([
        listEmailLogsForRow(row, brand),
        listEmailDeliveriesForRow(row, {
          sourceType,
          spreadsheetId: row.__spreadsheetId,
          sheetName: row.__sheetName,
          emailBrand: brand
        })
      ]);

      const history = [
        ...deliveries.map((delivery) => ({
          id: delivery.id,
          source: 'EmailDelivery',
          emailBrand: delivery.emailBrand,
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
          emailBrand: log.emailBrand,
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
      const { rows, emailBrand } = req.body as { rows?: ExcelRow[]; emailBrand?: any };
      const brand = parseEmailBrand(emailBrand);
      if (!rows || !Array.isArray(rows)) {
        return res.status(400).json({ error: 'Valid rows list must be supplied.' });
      }

      const dbRows = await applyDbTruthToRows(rows, brand);
      const ownership = await assertProcessBatchBrandOwnership(dbRows, brand);
      const plan = await buildProcessLeadPlan(dbRows);
      const flattenPlannedRows = (items: any[]) =>
        items.map((item) => ({
          ...(item.row || item),
          reason: item.reason || '',
          Remarks: item.row?.Remarks || item.reason || item.Remarks || ''
        }));
      return res.json({
        emailBrand: brand,
        lockedEmailBrand: ownership.lockedBrand,
        lockedBrands: ownership.lockedBrands,
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
      return sendRouteError(res, err, 'Lead process preview failed');
    }
  });

  app.get('/api/process-leads/queue-config', (req, res) => {
    return res.json({ enabled: isProcessQueueEnabled() });
  });

  app.post('/api/process-leads/jobs', async (req, res) => {
    try {
      return await withWorkflowActivity('lead-processing', async () => {
        if (!isProcessQueueEnabled()) {
          return res.status(409).json({ error: 'Process queue is disabled.' });
        }

        const { rows, sourceType, spreadsheetId, sheetName, headers: incomingHeaders, emailBrand } = req.body as {
          rows?: ExcelRow[];
          sourceType?: 'excel' | 'google-sheet';
          spreadsheetId?: string;
          sheetName?: string;
          headers?: string[];
          emailBrand?: any;
        };
        const brand = parseEmailBrand(emailBrand);

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
          const ensured = await ensureRequiredColumns(spreadsheetId, sheetName, headers, brand);
          headers = ensured.headers;
        }

        const dbRows = await applyDbTruthToRows(rows, brand);
        await assertProcessBatchBrandOwnership(dbRows, brand);
        const job = await createProcessLeadJob({
          sourceType: sourceType || 'excel',
          spreadsheetId,
          sheetName,
          headers,
          emailBrand: brand,
          rows: dbRows
        });
        await enqueueProcessLeadJob(job.id, job.generation);

        return res.status(202).json({
          jobId: job.id,
          status: job.status
        });
      });
    } catch (err: any) {
      console.error('Lead processing job enqueue failed:', err);
      if (err.statusCode) {
        return sendRouteError(res, err, 'Lead processing job enqueue failed');
      }
      const friendlyError = friendlySheetsError(err);
      if (req.body?.sourceType === 'google-sheet') {
        return res.status(friendlyError.status).json({ error: friendlyError.message });
      }
      return res.status(500).json({ error: err.message || 'Lead processing job enqueue failed' });
    }
  });

  app.get('/api/process-leads/jobs/:jobId', async (req, res) => {
    try {
      const job = await getProcessLeadJob(String(req.params.jobId || ''));
      if (!job) return res.status(404).json({ error: 'Process job not found.' });
      return res.json(serializeProcessLeadJob(job));
    } catch (err: any) {
      console.error('Lead processing job lookup failed:', err);
      return res.status(500).json({ error: err.message || 'Lead processing job lookup failed' });
    }
  });

  app.post('/api/process-leads', async (req, res) => {
    try {
      return await withWorkflowActivity('lead-processing', async () => {
        const { rows, sourceType, spreadsheetId, sheetName, headers: incomingHeaders, emailBrand } = req.body as {
          rows?: ExcelRow[];
          sourceType?: 'excel' | 'google-sheet';
          spreadsheetId?: string;
          sheetName?: string;
          headers?: string[];
          emailBrand?: any;
        };
        const brand = parseEmailBrand(emailBrand);

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
          const ensured = await ensureRequiredColumns(spreadsheetId, sheetName, headers, brand);
          headers = ensured.headers;
        }

        const dbRows = await applyDbTruthToRows(rows, brand);
        await assertProcessBatchBrandOwnership(dbRows, brand);
        const result = await processLeadsByStatus(dbRows, {
          sourceType: sourceType || 'excel',
          spreadsheetId,
          sheetName,
          headers,
          emailBrand: brand
        });

        return res.json({ ...result, headers });
      });
    } catch (err: any) {
      console.error('Lead processing failed:', err);
      if (err.statusCode) {
        return sendRouteError(res, err, 'Lead processing failed');
      }
      const friendlyError = friendlySheetsError(err);
      if (req.body?.sourceType === 'google-sheet') {
        return res.status(friendlyError.status).json({ error: friendlyError.message });
      }
      return res.status(500).json({ error: err.message || 'Lead processing failed' });
    }
  });

  app.post('/api/reconcile', async (req, res) => {
    try {
      const { rows, emailBrand } = req.body as { rows: ExcelRow[]; emailBrand?: any };
      const brand = parseEmailBrand(emailBrand);
      if (!rows || !Array.isArray(rows)) {
        return res.status(400).json({ error: 'Valid rows list must be supplied.' });
      }

      return res.json({ rows: await reconcileScheduledRows(rows, brand) });
    } catch (err: any) {
      console.error('Reconcile failed:', err);
      return sendRouteError(res, err, `Reconcile failed: ${err.message}`);
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
    emailBrand: delivery.emailBrand,
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
    emailBrand: job.emailBrand,
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
