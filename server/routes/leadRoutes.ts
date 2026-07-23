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
  markEmailSheetSyncFailed,
  markEmailSheetSyncSucceeded,
  markUnknownEmailDeliveryManuallyFailed,
  markUnknownEmailDeliveryManuallySent
} from '../emailDelivery';
import { listEmailLogsForRow } from '../emailLog';
import {
  ensureRequiredColumns,
  extractSheetInfo,
  friendlySheetsError,
  googleSheetAccessForWorkspace,
  getSheetTitleByGid,
  updateGoogleSheetRow
} from '../googleSheets';
import { cancelCalendarMeeting, sendGmailTemplate } from '../googleAuth';
import { updateGoogleSheetRowsResilient } from '../googleSheets';
import { isValidLeadStatus, LEAD_STATUS, normalizeLeadStatus } from '../leadStatus';
import { assertNoActiveResetClaims, cancelActiveCalendarEventsForReset, resetDemoTestData } from '../adminDb';
import { applyDbTruthToRows, assertDemoLifecycleOwnership, forceCloseActiveDemoForRow } from '../scheduleDb';
import {
  findSheetSyncJobById,
  claimSheetSyncJobForProcessing,
  listSheetSyncJobsForRow,
  markSheetSyncJobFailed,
  markSheetSyncJobSucceeded
} from '../sheetSyncQueue';
import {
  buildProcessLeadPlan,
  processLeadsByStatus,
  processScheduleRows,
  sendThankYouForRow,
  updateLeadStatusOnly
} from '../leadWorkflow';
import { assertProcessBatchLifecycleOwnership } from '../lifecycleOwnership';
import {
  createProcessLeadJob,
  getProcessLeadJob,
  serializeProcessLeadJob
} from '../processLeadJobs';
import { enqueueProcessLeadJob, isProcessQueueEnabled, prepareProcessQueueForReset } from '../processLeadQueue';
import { buildExportRow, normalizeRows, reconcileScheduledRows } from '../services/rowTransforms';
import { sendRouteError } from '../routeErrors';
import { coerceStoredEmailBrand, parseEmailBrand, type EmailBrandKey } from '../../src/lib/emailBrand';
import {
  clampActivityLimit,
  clampTrendDays,
  getDashboardActivity,
  getDashboardHealth,
  getScheduledLeadTrend,
  parseDashboardEmailBrandScope
} from '../dashboardService';
import {
  defaultEmailBrandForSenderAccount,
  defaultSenderAccountForBrand,
  parseSenderAccountKey,
  type SenderAccountKey
} from '../../src/lib/senderAccount';
import { beginResetGuard, withWorkflowActivity } from '../workflowActivity';
import { prisma } from '../db';
import {
  advanceWorkflowGenerationForReset,
  beginWorkflowResetWindow,
  finishWorkflowResetWindow
} from '../workflowControl';
import { buildSelectedTabWorkflowRows } from '../modules/source/ingestion/sourceIngestion.service';
import { SourceValidationError } from '../modules/source/sourceErrors';

type SheetSyncRunner = (
  spreadsheetId: string,
  sheetName: string,
  incomingHeaders: string[] | undefined,
  emailBrand: EmailBrandKey
) => Promise<any>;

function parseWorkspaceKey(value: unknown, fallback?: unknown): EmailBrandKey {
  return parseEmailBrand(value ?? fallback);
}

function parseProcessingKeys(input: {
  workspaceKey?: unknown;
  senderAccountKey?: unknown;
  googleAccountKey?: unknown;
  emailBrandKey?: unknown;
  emailBrand?: unknown;
}): {
  workspaceKey: EmailBrandKey;
  senderAccountKey: SenderAccountKey;
  googleAccountKey: SenderAccountKey;
  emailBrandKey: EmailBrandKey;
} {
  const explicitSenderAccountKey = input.senderAccountKey
    ? parseSenderAccountKey(input.senderAccountKey)
    : undefined;
  const fallbackBrand = explicitSenderAccountKey
    ? defaultEmailBrandForSenderAccount(explicitSenderAccountKey)
    : undefined;
  const emailBrandKey = parseEmailBrand(
    input.emailBrandKey ?? input.emailBrand ?? input.workspaceKey ?? fallbackBrand
  );
  const senderAccountKey = explicitSenderAccountKey || defaultSenderAccountForBrand(emailBrandKey);
  const workspaceKey = parseWorkspaceKey(input.workspaceKey, emailBrandKey);
  const googleAccountKey = input.googleAccountKey
    ? parseSenderAccountKey(input.googleAccountKey)
    : defaultSenderAccountForBrand(workspaceKey);
  return {
    workspaceKey,
    senderAccountKey,
    googleAccountKey,
    emailBrandKey
  };
}

type PreparedProcessRequest = {
  rows: ExcelRow[];
  sourceType: 'excel' | 'google-sheet';
  spreadsheetId?: string;
  sheetName?: string;
  headers?: string[];
  sourceId?: string;
  sourceTabId?: string;
  sourceSnapshotId?: string;
  selectedSourceRowIds?: string[];
  googleAccountKey?: SenderAccountKey;
  sourceScope?: {
    workspaceKey: EmailBrandKey;
    sourceId: string;
    sourceTabId: string;
    sourceSnapshotId: string;
    sourceDisplayName: string;
    sourceTabName: string;
    sourceType: 'excel' | 'google-sheet';
    googleAccountKey?: SenderAccountKey;
  };
};

function selectedSourceIdsFromBody(body: any) {
  const sourceId = String(body?.sourceId || body?.dataSourceId || '').trim();
  const sourceTabId = String(body?.sourceTabId || '').trim();
  const sourceSnapshotId = String(body?.sourceSnapshotId || '').trim();
  const selectedSourceRowIds: string[] | undefined = Array.isArray(body?.selectedSourceRowIds)
    ? Array.from(new Set<string>(body.selectedSourceRowIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)))
    : undefined;
  return { sourceId, sourceTabId, sourceSnapshotId, selectedSourceRowIds };
}

async function prepareProcessRequest(body: any, keys: ReturnType<typeof parseProcessingKeys>): Promise<PreparedProcessRequest> {
  const selected = selectedSourceIdsFromBody(body);
  const isSelectedSourceFlow = Boolean(selected.sourceId || selected.sourceTabId || selected.sourceSnapshotId);

  if (!isSelectedSourceFlow) {
    if (!Array.isArray(body?.rows)) {
      throw new SourceValidationError('Valid rows list must be supplied.');
    }
    return {
      rows: await applyDbTruthToRows(body.rows, keys.emailBrandKey),
      sourceType: body.sourceType === 'google-sheet' ? 'google-sheet' : 'excel',
      spreadsheetId: body.spreadsheetId,
      sheetName: body.sheetName,
      headers: Array.isArray(body.headers) ? body.headers : undefined,
      googleAccountKey: keys.googleAccountKey
    };
  }

  if (!selected.sourceId || !selected.sourceTabId || !selected.sourceSnapshotId) {
    throw new SourceValidationError('sourceId, sourceTabId and sourceSnapshotId are required.', 'SOURCE_TAB_REQUIRED');
  }

  const prepared = await buildSelectedTabWorkflowRows({
    workspaceKey: keys.workspaceKey,
    sourceId: selected.sourceId,
    sourceTabId: selected.sourceTabId,
    sourceSnapshotId: selected.sourceSnapshotId,
    selectedSourceRowIds: selected.selectedSourceRowIds,
    emailBrandKey: keys.emailBrandKey
  });
  const sourceType = prepared.source.type === 'GOOGLE_SHEETS' ? 'google-sheet' : 'excel';
  const headers = Array.isArray(prepared.tab.headersJson) ? prepared.tab.headersJson.map(String) : [];
  const googleAccountKey =
    sourceType === 'google-sheet'
      ? parseSenderAccountKey(prepared.source.googleAccountKey || keys.googleAccountKey)
      : keys.googleAccountKey;

  return {
    rows: prepared.rows,
    sourceType,
    spreadsheetId: sourceType === 'google-sheet' ? prepared.source.externalFileId || undefined : undefined,
    sheetName: sourceType === 'google-sheet' ? prepared.tab.name : undefined,
    headers,
    sourceId: prepared.source.id,
    sourceTabId: prepared.tab.id,
    sourceSnapshotId: prepared.snapshot.id,
    selectedSourceRowIds: selected.selectedSourceRowIds,
    googleAccountKey,
    sourceScope: {
      workspaceKey: prepared.workspaceKey,
      sourceId: prepared.source.id,
      sourceTabId: prepared.tab.id,
      sourceSnapshotId: prepared.snapshot.id,
      sourceDisplayName: prepared.source.displayName,
      sourceTabName: prepared.tab.name,
      sourceType,
      googleAccountKey
    }
  };
}

function getProvidedAdminResetToken(req: Request) {
  return String(
    req.get('x-admin-reset-token') || ''
  ).trim();
}

function adminTokensMatch(configuredToken: string, providedToken: string) {
  if (!configuredToken || !providedToken) return false;
  const configured = Buffer.from(configuredToken);
  const provided = Buffer.from(providedToken);
  return configured.length === provided.length && timingSafeEqual(configured, provided);
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.operator?.role === 'ADMIN') {
    return next();
  }

  if (process.env.ALLOW_LEGACY_ADMIN_TOKENS !== 'true') {
    return res.status(401).json({ error: 'Operator admin login required.' });
  }

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

async function resetDemoDataHandler(req: Request, res: Response) {
  let resumeQueue: (() => Promise<void>) | null = null;
  let finishResetGuard: (() => void) | null = null;
  let workflowResetWindowStarted = false;
  let resetBrand: EmailBrandKey | null = null;

  try {
    const { emailBrand, confirmation } = req.body as { emailBrand?: any; confirmation?: any };
    const brand = parseEmailBrand(emailBrand);
    const expectedConfirmation = `RESET_${brand.toUpperCase()}`;
    if (String(confirmation || '').trim() !== expectedConfirmation) {
      const error = new Error(`Confirmation must be ${expectedConfirmation}.`);
      (error as Error & { code?: string; statusCode?: number }).code = 'INVALID_RESET_CONFIRMATION';
      (error as Error & { code?: string; statusCode?: number }).statusCode = 400;
      throw error;
    }
    resetBrand = brand;
    finishResetGuard = beginResetGuard(brand);
    await beginWorkflowResetWindow(brand);
    workflowResetWindowStarted = true;
    resumeQueue = await prepareProcessQueueForReset(brand);
    await assertNoActiveResetClaims(brand);
    const calendarCleanup = await cancelActiveCalendarEventsForReset(brand);
    const workflowControl = await advanceWorkflowGenerationForReset(brand);
    const deletedCounts = await resetDemoTestData(brand);
    return res.json({
      success: true,
      emailBrand: brand,
      generation: workflowControl.generation,
      cancelledCalendarEventCount: calendarCleanup.cancelledCalendarEventCount,
      alreadyDeletedCalendarEventCount: calendarCleanup.alreadyDeletedCalendarEventCount,
      removedQueueJobCount: (resumeQueue as typeof resumeQueue & { removedQueueJobCount?: number })?.removedQueueJobCount || 0,
      deletedCounts,
      message: 'Selected brand workflow data, active Calendar events, and pending process jobs cleared.'
    });
  } catch (err: any) {
    console.error('Database reset failed:', err);
    return sendRouteError(res, err, 'Database reset failed');
  } finally {
    if (finishResetGuard) {
      finishResetGuard();
    }
    if (workflowResetWindowStarted) {
      if (resetBrand) await finishWorkflowResetWindow(resetBrand).catch((error) => {
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

  app.get('/api/dashboard/trend', async (req, res) => {
    try {
      const brand = parseDashboardEmailBrandScope(req.query.emailBrand, req.query.brand);
      const days = clampTrendDays(req.query.days);
      const data = await getScheduledLeadTrend(brand, days);
      return res.json({ emailBrand: brand, days, data });
    } catch (err: any) {
      return sendRouteError(res, err, 'Dashboard trend lookup failed');
    }
  });

  app.get('/api/dashboard/activity', async (req, res) => {
    try {
      const brand = parseDashboardEmailBrandScope(req.query.emailBrand, req.query.brand);
      const limit = clampActivityLimit(req.query.limit);
      const data = await getDashboardActivity(brand, limit);
      return res.json({ emailBrand: brand, limit, data });
    } catch (err: any) {
      return sendRouteError(res, err, 'Dashboard activity lookup failed');
    }
  });

  app.get('/api/dashboard/health', async (req, res) => {
    try {
      const brand = parseDashboardEmailBrandScope(req.query.emailBrand, req.query.brand);
      const data = await getDashboardHealth(brand);
      return res.json({ emailBrand: brand, data });
    } catch (err: any) {
      return sendRouteError(res, err, 'Dashboard health lookup failed');
    }
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
      const { sheetUrl, emailBrand, workspaceKey } = req.body as { sheetUrl?: string; emailBrand?: any; workspaceKey?: any };
      const brand = parseWorkspaceKey(workspaceKey, emailBrand);
      return await withWorkflowActivity('sheet-sync', brand, async () => {
        if (!sheetUrl) {
          return res.status(400).json({ error: 'Google Sheet URL is required.' });
        }

        const { spreadsheetId, gid } = extractSheetInfo(sheetUrl);
        const sheetName = await getSheetTitleByGid(spreadsheetId, gid, googleSheetAccessForWorkspace(brand));
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
      const { spreadsheetId, sheetName, headers: incomingHeaders, emailBrand, workspaceKey } = req.body as {
        spreadsheetId?: string;
        sheetName?: string;
        headers?: string[];
        emailBrand?: any;
        workspaceKey?: any;
      };
      const brand = parseWorkspaceKey(workspaceKey, emailBrand);
      return await withWorkflowActivity('sheet-sync', brand, async () => {

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
      const { rows } = req.body as { rows?: ExcelRow[] };
      const keys = parseProcessingKeys(req.body as any);
      return await withWorkflowActivity('lead-processing', keys.emailBrandKey, async () => {
        if (!rows || !Array.isArray(rows)) {
          return res.status(400).json({ error: 'Valid rows list must be supplied.' });
        }

        console.log(`Received request to schedule ${rows.length} rows...`);
        const { rows: results, summary } = await processScheduleRows(rows, {
          sheetContext: {
            sourceType: 'excel',
            workspaceKey: keys.workspaceKey,
            senderAccountKey: keys.senderAccountKey,
            googleAccountKey: keys.googleAccountKey,
            emailBrandKey: keys.emailBrandKey,
            emailBrand: keys.emailBrandKey
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
      const { spreadsheetId, sheetName, headers: incomingHeaders, rows } = req.body as {
        spreadsheetId?: string;
        sheetName?: string;
        headers?: string[];
        rows?: ExcelRow[];
      };
      const keys = parseProcessingKeys(req.body as any);
      return await withWorkflowActivity('lead-processing', keys.emailBrandKey, async () => {

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
        const { headers } = await ensureRequiredColumns(spreadsheetId, sheetName, incomingHeaders, googleSheetAccessForWorkspace(keys.workspaceKey));
        const preparedRows = rows.map((row) => ({
          ...row,
          __sourceType: 'google-sheet' as const,
          __workspaceKey: keys.workspaceKey,
          __spreadsheetId: spreadsheetId,
          __sheetName: sheetName,
          __originalColumns: headers
        }));
        const dbRows = await applyDbTruthToRows(preparedRows, keys.emailBrandKey);
        const result = await processLeadsByStatus(dbRows, {
          sourceType: 'google-sheet',
          spreadsheetId,
          sheetName,
          headers,
          workspaceKey: keys.workspaceKey,
          senderAccountKey: keys.senderAccountKey,
          googleAccountKey: keys.googleAccountKey,
          emailBrandKey: keys.emailBrandKey,
          emailBrand: keys.emailBrandKey
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
      const { row, sourceType, spreadsheetId, sheetName, headers } = req.body as {
        row?: ExcelRow;
        sourceType?: 'excel' | 'google-sheet';
        spreadsheetId?: string;
        sheetName?: string;
        headers?: string[];
      };
      const keys = parseProcessingKeys(req.body as any);
      return await withWorkflowActivity('lead-processing', keys.emailBrandKey, async () => {
        if (!row) return res.status(400).json({ error: 'Row is required.' });

        const [dbRow] = await applyDbTruthToRows([row], keys.emailBrandKey);
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
          workspaceKey: keys.workspaceKey,
          senderAccountKey: keys.senderAccountKey,
          googleAccountKey: keys.googleAccountKey,
          emailBrandKey: keys.emailBrandKey,
          emailBrand: keys.emailBrandKey
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
      const { rows, sourceType, spreadsheetId, sheetName, headers } = req.body as {
        rows?: ExcelRow[];
        sourceType?: 'excel' | 'google-sheet';
        spreadsheetId?: string;
        sheetName?: string;
        headers?: string[];
      };
      const keys = parseProcessingKeys(req.body as any);
      return await withWorkflowActivity('lead-processing', keys.emailBrandKey, async () => {
        if (!rows || !Array.isArray(rows)) {
          return res.status(400).json({ error: 'Valid rows list must be supplied.' });
        }

        const context = {
          sourceType: (sourceType || 'excel') as 'excel' | 'google-sheet',
          spreadsheetId,
          sheetName,
          headers,
          workspaceKey: keys.workspaceKey,
          senderAccountKey: keys.senderAccountKey,
          googleAccountKey: keys.googleAccountKey,
          emailBrandKey: keys.emailBrandKey,
          emailBrand: keys.emailBrandKey
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
          const [row] = await applyDbTruthToRows([rows[i]], keys.emailBrandKey);
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
      const { row, status, remarks, sourceType, spreadsheetId, sheetName, headers } = req.body as {
        row?: ExcelRow;
        status?: string;
        remarks?: string;
        sourceType?: 'excel' | 'google-sheet';
        spreadsheetId?: string;
        sheetName?: string;
        headers?: string[];
      };
      const keys = parseProcessingKeys(req.body as any);
      return await withWorkflowActivity('lead-processing', keys.emailBrandKey, async () => {

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
            workspaceKey: keys.workspaceKey,
            senderAccountKey: keys.senderAccountKey,
            googleAccountKey: keys.googleAccountKey,
            emailBrandKey: keys.emailBrandKey,
            emailBrand: keys.emailBrandKey
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
      const { row, remarks, sourceType, spreadsheetId, sheetName, headers } = req.body as {
        row?: ExcelRow;
        remarks?: string;
        sourceType?: 'excel' | 'google-sheet';
        spreadsheetId?: string;
        sheetName?: string;
        headers?: string[];
      };
      const keys = parseProcessingKeys(req.body as any);
      return await withWorkflowActivity('lead-processing', keys.emailBrandKey, async () => {

        if (!row) {
          return res.status(400).json({ error: 'Row is required.' });
        }

        const active = await assertDemoLifecycleOwnership(row, keys.emailBrandKey, keys.senderAccountKey);
        const calendarEventId = active.state.calendarEventId;
        if (calendarEventId) {
          await cancelCalendarMeeting(calendarEventId, active.senderAccountKey);
        }
        const updatedRow = await forceCloseActiveDemoForRow(row, remarks, keys.emailBrandKey, active.senderAccountKey);
        if (sourceType === 'google-sheet' && spreadsheetId && sheetName && headers?.length && row.__sheetRowNumber) {
          await updateGoogleSheetRow(spreadsheetId, sheetName, row.__sheetRowNumber, headers, {
            'Meeting Details': '',
            lead_status: String(updatedRow.lead_status || LEAD_STATUS.DEMO_SCHEDULED),
            Remarks: String(updatedRow.Remarks || '')
          }, googleSheetAccessForWorkspace(keys.workspaceKey));
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
      const { deliveryId } = req.params;
      const delivery = await findEmailDeliveryById(deliveryId);
      if (!delivery) return res.status(404).json({ error: 'Email delivery was not found.' });
      return await withWorkflowActivity('lead-processing', delivery.emailBrand, async () => {
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
          const senderAccountKey = parseSenderAccountKey(delivery.senderAccountKey);
          const result = await sendGmailTemplate(delivery.recipient, {
            subject: delivery.subject,
            text: delivery.textBody,
            html: delivery.htmlBody
          }, senderAccountKey);
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
      const { row, workspaceKey, emailBrand, emailBrandKey } = req.body as {
        row?: ExcelRow;
        workspaceKey?: any;
        emailBrand?: any;
        emailBrandKey?: any;
      };
      if (!row) return res.status(400).json({ error: 'Row is required.' });
      if (!workspaceKey && !row.__workspaceKey) {
        return res.status(400).json({ error: 'workspaceKey is required.' });
      }
      if (!emailBrandKey && !emailBrand && !row.__emailBrand) {
        return res.status(400).json({ error: 'emailBrand is required.' });
      }
      const sourceWorkspaceKey = parseEmailBrand(workspaceKey ?? row.__workspaceKey);
      const brand = parseEmailBrand(emailBrandKey ?? emailBrand ?? row.__emailBrand);
      const spreadsheetId = String(row.__spreadsheetId || '');
      const sheetName = String(row.__sheetName || '');
      const rowNumber = Number(row.__sheetRowNumber || row.__sourceRowNumber);
      if (!spreadsheetId || !sheetName || !rowNumber) {
        return res.json({ jobs: [] });
      }

      const jobs = await listSheetSyncJobsForRow({
        workspaceKey: sourceWorkspaceKey,
        emailBrand: brand,
        spreadsheetId,
        sheetName,
        rowNumber,
        dataSourceId: row.__sourceId,
        sourceTabId: row.__sourceTabId,
        sourceRowId: row.__sourceRowId
      });
      return res.json({ jobs: jobs.map(serializeSheetSyncJob) });
    } catch (err: any) {
      console.error('Sheet sync job lookup failed:', err);
      return sendRouteError(res, err, 'Sheet sync job lookup failed');
    }
  });

  app.post('/api/sheet-sync/jobs/:jobId/retry', async (req, res) => {
    try {
      const { jobId } = req.params;
      const job = await findSheetSyncJobById(jobId);
      if (!job) return res.status(404).json({ error: 'Sheet sync job was not found.' });
      const workspaceKey = parseEmailBrand(job.workspaceKey);
      const emailBrand = parseEmailBrand(job.emailBrand);
      const googleAccountKey = parseSenderAccountKey(job.googleAccountKey);
      return await withWorkflowActivity('sheet-sync', emailBrand, async () => {
        if (job.status === 'SYNCED') {
          return res.json({ success: true, job: serializeSheetSyncJob(job), skipped: true });
        }

        const claimed = await claimSheetSyncJobForProcessing(jobId, { manual: true });
        if (!claimed) {
          const updated = await findSheetSyncJobById(jobId);
          return res.status(409).json({
            error: 'This sheet sync job is already being processed.',
            job: serializeSheetSyncJob(updated)
          });
        }

        try {
          let linkedDeliveryId: string | undefined;
          if (job.emailDeliveryId) {
            const delivery = await findEmailDeliveryById(job.emailDeliveryId);
            if (!delivery) {
              throw new Error('Linked EmailDelivery was not found for this sheet sync job.');
            }
            if (parseEmailBrand(delivery.emailBrand) !== emailBrand) {
              throw new Error('Linked EmailDelivery brand does not match this sheet sync job.');
            }
            linkedDeliveryId = delivery.id;
          }

          const headers = JSON.parse(job.headersJson) as string[];
          const values = JSON.parse(job.valuesJson) as Record<string, any>;
          const [result] = await updateGoogleSheetRowsResilient(
            job.spreadsheetId,
            job.sheetName,
            headers,
            [{
              rowNumber: job.rowNumber,
              values,
              emailDeliveryId: job.emailDeliveryId || undefined,
              dataSourceId: job.dataSourceId || undefined,
              sourceTabId: job.sourceTabId || undefined,
              sourceRowId: job.sourceRowId || undefined
            }],
            {},
            { workspaceKey, googleAccountKey }
          );

          if (!result?.success) {
            throw new Error(result?.error || 'Google Sheet row update failed');
          }

          await markSheetSyncJobSucceeded(jobId);
          if (linkedDeliveryId) {
            await markEmailSheetSyncSucceeded(linkedDeliveryId);
          }
          const updated = await findSheetSyncJobById(jobId);
          return res.json({ success: true, job: serializeSheetSyncJob(updated) });
        } catch (error) {
          await markSheetSyncJobFailed(jobId, error);
          if (job.emailDeliveryId) {
            const delivery = await findEmailDeliveryById(job.emailDeliveryId);
            if (delivery && parseEmailBrand(delivery.emailBrand) === emailBrand) {
              await markEmailSheetSyncFailed(delivery.id, error);
            }
          }
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
      const keys = parseProcessingKeys(req.body as any);
      const preparedRequest = await prepareProcessRequest(req.body, keys);
      const dbRows = preparedRequest.rows;
      const ownership = await assertProcessBatchLifecycleOwnership(
        dbRows,
        keys.emailBrandKey,
        keys.senderAccountKey
      );
      const lockedSenderAccountKeys = ownership.lockedSenderAccountKeys;
      const plan = await buildProcessLeadPlan(dbRows);
      const flattenPlannedRows = (items: any[]) =>
        items.map((item) => ({
          ...(item.row || item),
          reason: item.reason || '',
          Remarks: item.row?.Remarks || item.reason || item.Remarks || ''
        }));
      return res.json({
        workspaceKey: keys.workspaceKey,
        senderAccountKey: keys.senderAccountKey,
        googleAccountKey: preparedRequest.googleAccountKey || keys.googleAccountKey,
        emailBrandKey: keys.emailBrandKey,
        emailBrand: keys.emailBrandKey,
        sourceId: preparedRequest.sourceId,
        sourceTabId: preparedRequest.sourceTabId,
        sourceSnapshotId: preparedRequest.sourceSnapshotId,
        sourceDisplayName: preparedRequest.sourceScope?.sourceDisplayName,
        sourceTabName: preparedRequest.sourceScope?.sourceTabName,
        sourceType: preparedRequest.sourceType,
        sourceScope: preparedRequest.sourceScope,
        lockedSenderAccountKey: lockedSenderAccountKeys.length === 1 ? lockedSenderAccountKeys[0] : undefined,
        lockedSenderAccountKeys,
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
      const keys = parseProcessingKeys(req.body as any);
      return await withWorkflowActivity('lead-processing', keys.emailBrandKey, async () => {
        if (!isProcessQueueEnabled()) {
          return res.status(409).json({ error: 'Process queue is disabled.' });
        }

        const preparedRequest = await prepareProcessRequest(req.body, keys);

        let headers = preparedRequest.headers || [];
        if (preparedRequest.sourceType === 'google-sheet') {
          if (!preparedRequest.spreadsheetId || !preparedRequest.sheetName) {
            return res.status(400).json({ error: 'spreadsheetId and sheetName are required.' });
          }
          if (!headers.length) {
            return res.status(400).json({ error: 'Google Sheet headers are required.' });
          }
          const ensured = await ensureRequiredColumns(preparedRequest.spreadsheetId, preparedRequest.sheetName, headers, {
            workspaceKey: keys.workspaceKey,
            googleAccountKey: preparedRequest.googleAccountKey || keys.googleAccountKey
          });
          headers = ensured.headers;
        }

        const dbRows = preparedRequest.rows;
        await assertProcessBatchLifecycleOwnership(dbRows, keys.emailBrandKey, keys.senderAccountKey);
        const job = await createProcessLeadJob({
          sourceType: preparedRequest.sourceType,
          workspaceKey: keys.workspaceKey,
          spreadsheetId: preparedRequest.spreadsheetId,
          sheetName: preparedRequest.sheetName,
          headers,
          senderAccountKey: keys.senderAccountKey,
          googleAccountKey: preparedRequest.googleAccountKey || keys.googleAccountKey,
          emailBrandKey: keys.emailBrandKey,
          emailBrand: keys.emailBrandKey,
          sourceId: preparedRequest.sourceId,
          sourceTabId: preparedRequest.sourceTabId,
          sourceSnapshotId: preparedRequest.sourceSnapshotId,
          sourceRowIds: preparedRequest.rows.map((row) => row.__sourceRowId || row.id).filter(Boolean),
          rows: dbRows
        });
        await enqueueProcessLeadJob(job.id, job.generation, keys.emailBrandKey);

        return res.status(202).json({
          jobId: job.id,
          status: job.status,
          sourceScope: preparedRequest.sourceScope
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
      const keys = parseProcessingKeys(req.body as any);
      return await withWorkflowActivity('lead-processing', keys.emailBrandKey, async () => {

        const preparedRequest = await prepareProcessRequest(req.body, keys);

        let headers = preparedRequest.headers || [];
        if (preparedRequest.sourceType === 'google-sheet') {
          if (!preparedRequest.spreadsheetId || !preparedRequest.sheetName) {
            return res.status(400).json({ error: 'spreadsheetId and sheetName are required.' });
          }
          if (!headers.length) {
            return res.status(400).json({ error: 'Google Sheet headers are required.' });
          }
          const ensured = await ensureRequiredColumns(preparedRequest.spreadsheetId, preparedRequest.sheetName, headers, {
            workspaceKey: keys.workspaceKey,
            googleAccountKey: preparedRequest.googleAccountKey || keys.googleAccountKey
          });
          headers = ensured.headers;
        }

        const dbRows = preparedRequest.rows;
        await assertProcessBatchLifecycleOwnership(dbRows, keys.emailBrandKey, keys.senderAccountKey);
        const result = await processLeadsByStatus(dbRows, {
          sourceType: preparedRequest.sourceType,
          spreadsheetId: preparedRequest.spreadsheetId,
          sheetName: preparedRequest.sheetName,
          headers,
          workspaceKey: keys.workspaceKey,
          senderAccountKey: keys.senderAccountKey,
          googleAccountKey: preparedRequest.googleAccountKey || keys.googleAccountKey,
          emailBrandKey: keys.emailBrandKey,
          emailBrand: keys.emailBrandKey
        });

        return res.json({ ...result, headers, sourceScope: preparedRequest.sourceScope });
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
      const { rows, workspaceKey, emailBrand } = req.body as { rows: ExcelRow[]; workspaceKey?: any; emailBrand?: any };
      const brand = parseWorkspaceKey(workspaceKey, emailBrand);
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
    workspaceKey: job.workspaceKey,
    emailBrand: job.emailBrand,
    googleAccountKey: job.googleAccountKey,
    spreadsheetId: job.spreadsheetId,
    sheetName: job.sheetName,
    rowNumber: job.rowNumber,
    dataSourceId: job.dataSourceId,
    sourceTabId: job.sourceTabId,
    sourceRowId: job.sourceRowId,
    status: job.status,
    retryCount: job.retryCount,
    maxRetries: job.maxRetries,
    nextRetryAt: job.nextRetryAt,
    lockedAt: job.lockedAt,
    lockedBy: job.lockedBy,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}
