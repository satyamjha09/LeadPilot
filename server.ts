import express from 'express';
import path from 'path';
import xlsx from 'xlsx';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';

// Load environmental variables
dotenv.config();

import { 
  getAuthStatus, 
  exchangeCodeAndSave, 
  clearCredentials, 
  parseExcelDateTime
} from './server/googleAuth';

import {
  getScheduledReminders,
  getReminderConfig,
  saveReminderConfig,
  initReminderJob
} from './server/reminders';

import {
  ensureRequiredColumns,
  extractSheetInfo,
  friendlySheetsError,
  getSheetTitleByGid,
  readSheetRows,
  updateGoogleSheetRow
} from './server/googleSheets';

import { ExcelRow } from './src/types';
import { findScheduledMeetLinkFromDb } from './server/scheduleDb';
import { listEmailLogsForRow } from './server/emailLog';
import { LEAD_STATUS, isValidLeadStatus, normalizeLeadStatus } from './server/leadStatus';
import {
  buildProcessLeadPlan,
  processScheduleRows,
  processLeadsByStatus,
  sendThankYouForRow,
  updateLeadStatusOnly,
  hasGoogleMeetLink,
  isValidEmail
} from './server/leadWorkflow';

const PORT = 3000;

async function startServer() {
  const app = express();

  // Support JSON payload with larger limit for base64 file payloads
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Initialize automatic reminders scanner scheduler on server starting
  initReminderJob();

  // --- API ROUTING DEFINITIONS ---
  const validationRemark = (field: string) => `${field} is missing. Add it in the Excel row before scheduling.`;

  const findValueInRow = (row: Record<string, any>, possibleKeys: string[]): any => {
    for (const key of possibleKeys) {
      if (row[key] !== undefined) return row[key];
      for (const rowKey of Object.keys(row)) {
        if (rowKey.trim().toLowerCase() === key.toLowerCase()) {
          return row[rowKey];
        }
      }
    }
    return undefined;
  };

  const reconcileScheduledRows = async (rows: ExcelRow[]) => {
    const reconciled: ExcelRow[] = [];

    for (const row of rows) {
      if (hasGoogleMeetLink(row['Meeting Details'])) {
        reconciled.push({
          ...row,
          lead_status: LEAD_STATUS.DEMO_SCHEDULED,
          Remarks: row.Remarks || 'Already booked (skipped)'
        });
        continue;
      }

      const existingMeetLink = await findScheduledMeetLinkFromDb(row);
      if (!existingMeetLink) {
        reconciled.push(row);
        continue;
      }

      reconciled.push({
        ...row,
        'Meeting Details': existingMeetLink,
        lead_status: LEAD_STATUS.DEMO_SCHEDULED,
        Remarks: row.Remarks || 'Already scheduled from database'
      });
    }

    return reconciled;
  };

  const validateScheduleDateTime = (dateValue: any, timeValue: any) => {
    const startTime = parseExcelDateTime(dateValue, timeValue);
    if (startTime.getTime() <= Date.now()) {
      throw new Error('Meeting date/time is in the past. Choose a future Date of Demo and Time of Demo.');
    }
    return startTime;
  };

  const formatExcelTime = (value: any) => {
    const pad = (part: number) => String(part).padStart(2, '0');
    const formatParts = (hours24: number, minutes: number, seconds: number) => {
      const suffix = hours24 >= 12 ? 'PM' : 'AM';
      const hours12 = hours24 % 12 || 12;
      const secondsPart = seconds ? `:${pad(seconds)}` : '';
      return `${hours12}:${pad(minutes)}${secondsPart} ${suffix}`;
    };

    if (typeof value === 'number') {
      const totalSeconds = Math.round(value * 86400);
      return formatParts(
        Math.floor(totalSeconds / 3600) % 24,
        Math.floor((totalSeconds % 3600) / 60),
        totalSeconds % 60
      );
    }

    if (value instanceof Date) {
      const useUtc = value.getUTCFullYear() <= 1900;
      return formatParts(
        useUtc ? value.getUTCHours() : value.getHours(),
        useUtc ? value.getUTCMinutes() : value.getMinutes(),
        useUtc ? value.getUTCSeconds() : value.getSeconds()
      );
    }

    return typeof value === 'string' ? value.trim() : value;
  };

  const buildExportRow = (row: ExcelRow) => {
    const originalColumns = row.__originalColumns || [];
    const helperColumns = new Set([
      'id',
      '__originalColumns',
      '__schedulerStatus',
      'full_name',
      'email',
      'Date of Demo',
      'Time of Demo'
    ]);
    const outputColumns = ['Meeting Details', 'lead_status', 'Remarks'];
    const exportRow: Record<string, any> = {};

    for (const column of originalColumns) {
      if (column !== 'id' && column !== '__originalColumns') {
        exportRow[column] = row[column];
      }
    }

    for (const column of Object.keys(row)) {
      if (!helperColumns.has(column) && !outputColumns.includes(column) && !originalColumns.includes(column)) {
        exportRow[column] = row[column];
      }
    }

    exportRow['Meeting Details'] = row['Meeting Details'] || '';
    exportRow.lead_status = row.lead_status || '';
    exportRow.Remarks = row.Remarks || '';

    return exportRow;
  };

  const normalizeRows = (rows: Record<string, any>[], options?: { idPrefix?: string; rowOffset?: number }) => {
    const idPrefix = options?.idPrefix || 'row';
    const rowOffset = options?.rowOffset || 0;

    const validatedRows: ExcelRow[] = rows.map((row, index) => {
      const fullName = String(
        findValueInRow(row, ['full_name', 'Full Name', 'Name', 'client_name', 'Client Name', 'lead_name', 'Lead Name', 'Lead', 'Client']) || ''
      ).trim();

      const email = String(
        findValueInRow(row, ['email', 'Email', 'EMAIL', 'Email Id', 'email_id', 'email_address', 'Email Address', 'mail', 'contact_email', 'Contact Email']) || ''
      ).trim();

      let dateDemo = findValueInRow(row, ['Date of Demo', 'date_of_demo', 'Date', 'demo_date', 'Demo Date', 'schedule_date', 'Schedule Date', 'meeting_date', 'Meeting Date']) || '';
      if (dateDemo instanceof Date) {
        dateDemo = dateDemo.toISOString().slice(0, 10);
      } else if (typeof dateDemo === 'string') {
        dateDemo = dateDemo.trim();
      }

      const timeDemo = formatExcelTime(findValueInRow(row, ['Time of Demo', 'time_of_demo', 'Time', 'demo_time', 'Demo Time', 'schedule_time', 'Schedule Time', 'meeting_time', 'Meeting Time']) || '');

      const meetDetails = String(
        findValueInRow(row, ['Meeting Details', 'meeting_details', 'Meet Link', 'meet_link', 'Google Meet', 'google_meet', 'Link', 'link']) || ''
      ).trim();

      const rawLeadStatus = String(
        findValueInRow(row, ['lead_status', 'Status', 'Lead Status', 'status']) || ''
      ).trim();
      let leadStatus = normalizeLeadStatus(rawLeadStatus) || rawLeadStatus;
      let schedulerStatus: ExcelRow['__schedulerStatus'] = undefined;

      let remarks = String(
        findValueInRow(row, ['Remarks', 'remarks', 'Note', 'Notes', 'Diagnostic', 'diagnostics', 'Comment', 'Comments']) || ''
      ).trim();

      const hasMeetUrl = hasGoogleMeetLink(meetDetails);

      if (!leadStatus) {
        leadStatus = LEAD_STATUS.FOLLOW_UP;
      }

      if (hasMeetUrl) {
        leadStatus = LEAD_STATUS.DEMO_SCHEDULED;
        if (!remarks) remarks = 'Already has Google Meet link';
      } else if (leadStatus === LEAD_STATUS.DEMO_SCHEDULED) {
        if (!email) {
          schedulerStatus = 'Failed';
          remarks = validationRemark('Email');
        } else if (!isValidEmail(email)) {
          schedulerStatus = 'Failed';
          remarks = 'Email is invalid. Add a valid recipient email before scheduling.';
        } else if (!dateDemo) {
          schedulerStatus = 'Failed';
          remarks = validationRemark('Date of Demo');
        } else if (!timeDemo) {
          schedulerStatus = 'Failed';
          remarks = validationRemark('Time of Demo');
        } else {
          try {
            validateScheduleDateTime(dateDemo, timeDemo);
          } catch (err: any) {
            schedulerStatus = 'Failed';
            remarks = err.message || 'Date or time is invalid.';
          }
        }
      } else if (leadStatus === LEAD_STATUS.DEMO_DONE) {
        if (!email) {
          schedulerStatus = 'Failed';
          remarks = validationRemark('Email');
        } else if (!isValidEmail(email)) {
          schedulerStatus = 'Failed';
          remarks = 'Email is invalid. Add a valid recipient email before sending thank-you email.';
        }
      } else if (!isValidLeadStatus(leadStatus)) {
        schedulerStatus = 'Failed';
        remarks = 'Invalid lead_status value.';
      } else if (dateDemo && timeDemo) {
        try {
          validateScheduleDateTime(dateDemo, timeDemo);
        } catch (err: any) {
          if (!remarks) remarks = err.message || 'Date or time is invalid.';
        }
      }

      return {
        ...row,
        id: `${idPrefix}-${index}-${Date.now()}`,
        __originalColumns: Object.keys(row),
        __sourceRowNumber: rowOffset ? rowOffset + index : undefined,
        full_name: fullName,
        email,
        'Date of Demo': dateDemo,
        'Time of Demo': timeDemo,
        'Meeting Details': meetDetails,
        lead_status: leadStatus as ExcelRow['lead_status'],
        __schedulerStatus: schedulerStatus,
        Remarks: remarks
      };
    });

    return validatedRows;
  };

  // Health endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // 1. POST /api/preview
  app.post('/api/preview', (req, res) => {
    try {
      const { fileData } = req.body;
      if (!fileData) {
        return res.status(400).json({ error: 'No Excel file data supplied.' });
      }

      // Read buffer from base64 string
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
      const sheetData = await readSheetRows(spreadsheetId, sheetName);
      const { headers } = await ensureRequiredColumns(spreadsheetId, sheetName, sheetData.headers);

      const rows = sheetData.rows.map(row => ({
        ...row,
        __originalColumns: headers
      }));

      return res.json({
        source: 'google-sheet',
        spreadsheetId,
        gid,
        sheetName,
        rows,
        headers
      });
    } catch (err: any) {
      console.error('Google Sheets import failed:', err);
      const friendlyError = friendlySheetsError(err);
      return res.status(friendlyError.status).json({ error: friendlyError.message });
    }
  });

  // 2. POST /api/schedule
  app.post('/api/schedule', async (req, res) => {
    try {
      const { rows } = req.body as { rows: ExcelRow[] };
      if (!rows || !Array.isArray(rows)) {
        return res.status(400).json({ error: 'Valid rows list must be supplied.' });
      }

      console.log(`Received request to schedule ${rows.length} rows...`);
      const rowsForSchedule = rows.map((row) => ({
        ...row,
        lead_status: LEAD_STATUS.DEMO_SCHEDULED
      }));
      const { rows: results, summary } = await processScheduleRows(rowsForSchedule);
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
      const rowsForSchedule = rows.map((row) => ({
        ...row,
        lead_status: LEAD_STATUS.DEMO_SCHEDULED
      }));
      const sheetContext = {
        sourceType: 'google-sheet' as const,
        spreadsheetId,
        sheetName,
        headers
      };
      const { rows: results, summary } = await processScheduleRows(rowsForSchedule, {
        sheetContext,
        onRowProcessed: async (row, index) => {
          const sheetRowNumber = Number(row.__sheetRowNumber || rows[index]?.__sheetRowNumber || row.__sourceRowNumber || rows[index]?.__sourceRowNumber || index + 2);
          if (!sheetRowNumber || sheetRowNumber < 2) return;

          await updateGoogleSheetRow(spreadsheetId, sheetName, sheetRowNumber, headers, {
            'Meeting Details': row['Meeting Details'] || '',
            lead_status: row.lead_status || LEAD_STATUS.DEMO_SCHEDULED,
            Remarks: row.Remarks || ''
          });
        }
      });

      for (let index = 0; index < results.length; index++) {
        const row = results[index];
        const sheetRowNumber = Number(row.__sheetRowNumber || rows[index]?.__sheetRowNumber || row.__sourceRowNumber || rows[index]?.__sourceRowNumber || index + 2);
        if (!sheetRowNumber || sheetRowNumber < 2) continue;

        row.__originalColumns = headers;
      }

      return res.json({ rows: results, summary: { total: summary.totalRows, ...summary }, headers });
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

      const logs = await listEmailLogsForRow(row);
      return res.json({
        logs: logs.map((log) => ({
          id: log.id,
          type: log.type,
          status: log.status,
          messageId: log.messageId,
          error: log.error,
          createdAt: log.createdAt
        }))
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
      return res.json({
        summary: plan.summary,
        estimatedTime: plan.estimatedTime,
        meetingRecipients: plan.meetingRecipients.slice(0, 5),
        thankYouRecipients: plan.thankYouRecipients.slice(0, 5),
        groups: {
          demoScheduledRows: plan.demoScheduledRows,
          demoDoneRows: plan.demoDoneRows,
          statusOnlyRows: plan.statusOnlyRows,
          invalidRows: plan.invalidRows,
          skippedRows: plan.skippedRows
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

  // 3. POST /api/export
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

  // Google OAuth flow helper endpoints
  app.get('/api/auth/status', async (req, res) => {
    try {
      const status = await getAuthStatus();
      return res.json(status);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/auth/clear', (req, res) => {
    try {
      clearCredentials();
      return getAuthStatus().then(status => {
        return res.json({ success: true, message: 'Google authentication cleared.', status });
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Handler for trailing slash dynamic matches
  app.get(['/api/auth/callback/google', '/api/auth/callback/google/'], async (req, res) => {
    try {
      const { code } = req.query;
      if (!code) {
        return res.status(400).send('Missing authorization code.');
      }

      await exchangeCodeAndSave(String(code));

      // Simple HTML popup closure sender
      return res.send(`
        <html>
          <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background-color: #f3f4f6; margin: 0;">
            <div style="background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center;">
              <h2 style="color: #10b981; margin-top: 0;">Authentication Successful!</h2>
              <p style="color: #4b5563; margin-bottom: 1.5rem;">Excel Meet Scheduler has been linked with your Google Workspace credentials.</p>
              <p style="color: #9ca3af; font-size: 0.875rem;">This window will close automatically...</p>
            </div>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                setTimeout(function() { window.close(); }, 2000);
              } else {
                window.location.href = '/';
              }
            </script>
          </body>
        </html>
      `);
    } catch (err: any) {
      console.error('Google callback error:', err);
      return res.status(500).send(`Authentication exchange failed: ${err.message}`);
    }
  });

  // Reminders telemetry routes
  app.get('/api/reminders/status', (req, res) => {
    try {
      const reminders = getScheduledReminders();
      const config = getReminderConfig();
      return res.json({ reminders, config });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/reminders/config', (req, res) => {
    try {
      const { offsetMinutes, enabled } = req.body;
      if (typeof offsetMinutes !== 'number' || typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Config values offsetMinutes (number) and enabled (boolean) are required.' });
      }
      if (![30, 60, 120].includes(offsetMinutes)) {
        return res.status(400).json({ error: 'Reminder timing must be 30, 60, or 120 minutes.' });
      }

      saveReminderConfig({ offsetMinutes, enabled });
      return res.json({ success: true, config: { offsetMinutes, enabled } });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });


  // --- VITE MIDDLEWARE CONFIGURATION ---

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static frontend build assets
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`-----------------------------------------------`);
    console.log(`Excel Meet Scheduler server starts on port ${PORT}`);
    console.log(`Env Redirect URI configured as: ${process.env.GOOGLE_REDIRECT_URI}`);
    console.log(`-----------------------------------------------`);
  });
}

startServer();
