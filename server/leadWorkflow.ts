import { ExcelRow, ScheduleSummary } from '../src/types';
import {
  parseExcelDateTime,
  scheduleMeeting,
  sendGmailInvite,
  sendThankYouEmail
} from './googleAuth';
import { updateGoogleSheetRow, updateGoogleSheetRowsBatch } from './googleSheets';
import { EMAIL_LOG_TYPES, hasEmailBeenSent, logEmailSent } from './emailLog';
import { LEAD_STATUS, isDemoScheduledStatus, normalizeLeadStatus } from './leadStatus';
import {
  findLeadSchedule,
  findScheduledMeetLinkFromDb,
  saveLeadScheduleFailure,
  saveLeadScheduleSuccess,
  saveLeadStatusUpdate
} from './scheduleDb';
import { addScheduledReminder } from './reminders';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PROCESS_DELAY_MS = 1000;

const STATUS_ONLY_VALUES = new Set<string>([
  LEAD_STATUS.NO_RESPONSE,
  LEAD_STATUS.FOLLOW_UP,
  LEAD_STATUS.TO_BE_CALLED,
  LEAD_STATUS.NOT_REQUIRED,
  LEAD_STATUS.REPEATED,
  LEAD_STATUS.RESCHEDULE
]);

export const hasGoogleMeetLink = (value: unknown) => /meet\.google\.com/i.test(String(value || ''));

export const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export type SheetContext = {
  sourceType: 'excel' | 'google-sheet';
  spreadsheetId?: string;
  sheetName?: string;
  headers?: string[];
};

type WorkflowOptions = {
  skipSheetSync?: boolean;
};

type PlannedRow = {
  row: ExcelRow;
  reason?: string;
};

type TimeConflictGroup = {
  key: string;
  date: string;
  time: string;
  count: number;
  names: string[];
  rowIds: string[];
};

export type ProcessLeadPlan = {
  demoScheduledRows: ExcelRow[];
  rescheduleRows: ExcelRow[];
  demoDoneRows: ExcelRow[];
  statusOnlyRows: ExcelRow[];
  invalidRows: PlannedRow[];
  skippedRows: PlannedRow[];
  timeConflictRows: PlannedRow[];
  timeConflictGroups: TimeConflictGroup[];
  meetingRecipients: string[];
  thankYouRecipients: string[];
  estimatedTime: {
    minMinutes: number;
    maxMinutes: number;
    label: string;
  };
  summary: {
    total: number;
    demoScheduled: number;
    reschedule: number;
    demoDone: number;
    statusOnly: number;
    invalid: number;
    skipped: number;
    timeConflicts: number;
    actionable: number;
  };
};

export type ProcessLeadsResult = {
  rows: ExcelRow[];
  summary: {
    total: number;
    demoScheduled: number;
    reschedule: number;
    demoDone: number;
    statusOnly: number;
    failed: number;
    skipped: number;
    timeConflicts: number;
  };
};

export function normalizeWorkflowStatus(value: unknown) {
  return normalizeLeadStatus(value);
}

export function isStatusOnlyStatus(value: unknown) {
  const normalized = normalizeLeadStatus(value);
  return normalized !== '' && STATUS_ONLY_VALUES.has(normalized);
}

const pad = (value: number) => String(value).padStart(2, '0');
const TIME_CONFLICT_REMARK = 'Time conflict: another lead has the same date and time';

function normalizeMeetingDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date((value - 25569) * 86400 * 1000).toISOString().slice(0, 10);
  }

  const raw = String(value || '').trim();
  if (!raw) return '';

  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  return raw.toLowerCase().replace(/\s+/g, ' ');
}

function normalizeMeetingTime(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const totalMinutes = Math.round(value * 24 * 60);
    return `${pad(Math.floor(totalMinutes / 60) % 24)}:${pad(totalMinutes % 60)}`;
  }

  const raw = String(value || '').trim();
  if (!raw) return '';

  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/i);
  if (match) {
    let hours = Number(match[1]);
    const minutes = Number(match[2] || 0);
    const suffix = match[3]?.toLowerCase();
    if (suffix === 'pm' && hours < 12) hours += 12;
    if (suffix === 'am' && hours === 12) hours = 0;
    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      return `${pad(hours)}:${pad(minutes)}`;
    }
  }

  return raw.toLowerCase().replace(/\s+/g, ' ');
}

function isMeetingAction(row: ExcelRow) {
  const normalized = normalizeLeadStatus(row.lead_status);
  return normalized === LEAD_STATUS.DEMO_SCHEDULED || normalized === LEAD_STATUS.RESCHEDULE;
}

function getMeetingTimeKey(row: ExcelRow) {
  const date = normalizeMeetingDate(row['Date of Demo']);
  const time = normalizeMeetingTime(row['Time of Demo']);
  return date && time ? `${date}__${time}` : '';
}

export function findTimeConflictGroups(rows: ExcelRow[]): TimeConflictGroup[] {
  const groups = new Map<string, ExcelRow[]>();

  for (const row of rows) {
    if (!isMeetingAction(row)) continue;
    const key = getMeetingTimeKey(row);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), row]);
  }

  return Array.from(groups.entries())
    .filter(([, groupRows]) => groupRows.length > 1)
    .map(([key, groupRows]) => {
      const [date, time] = key.split('__');
      return {
        key,
        date,
        time,
        count: groupRows.length,
        names: groupRows.map((row) => String(row.full_name || row.email || row.id || 'Lead')).slice(0, 5),
        rowIds: groupRows.map((row) => row.id)
      };
    });
}

function failureRow(row: ExcelRow, message: string): ExcelRow {
  return {
    ...row,
    __schedulerStatus: 'Failed',
    Remarks: message
  };
}

function estimateProcessingTime(demoScheduled: number, demoDone: number, statusOnly: number) {
  const minSeconds = demoScheduled * 5 + demoDone * 3 + statusOnly * 0.1;
  const maxSeconds = demoScheduled * 8 + demoDone * 5 + statusOnly * 0.2;
  const minMinutes = Math.max(0, Math.ceil(minSeconds / 60));
  const maxMinutes = Math.max(minMinutes, Math.ceil(maxSeconds / 60));

  return {
    minMinutes,
    maxMinutes,
    label:
      maxMinutes <= 1
        ? 'under 1 minute'
        : minMinutes === maxMinutes
          ? `${maxMinutes} minutes`
          : `${minMinutes}-${maxMinutes} minutes`
  };
}

function validateDemoScheduledRow(row: ExcelRow) {
  const email = String(row.email || '').trim();
  if (!email) return 'Email is missing.';
  if (!isValidEmail(email)) return 'Email is invalid.';
  if (!row['Date of Demo']) return 'Date of Demo is missing.';
  if (!row['Time of Demo']) return 'Time of Demo is missing.';

  try {
    const startTime = parseExcelDateTime(row['Date of Demo'], row['Time of Demo']);
    if (startTime.getTime() <= Date.now()) {
      return 'Meeting date/time is in the past. Choose a future Date of Demo and Time of Demo.';
    }
  } catch (err: unknown) {
    return err instanceof Error ? err.message : 'Date or time is invalid.';
  }

  return '';
}

function validateDemoDoneRow(row: ExcelRow) {
  const email = String(row.email || '').trim();
  if (!email) return 'Email is missing.';
  if (!isValidEmail(email)) return 'Email is invalid.';
  return '';
}

function sheetRowNumber(row: ExcelRow) {
  return Number(row.__sheetRowNumber || row.__sourceRowNumber || 0);
}

function collectSheetUpdate(
  updates: Array<{ rowNumber: number; values: Record<string, any> }>,
  row: ExcelRow,
  values: Record<string, any>
) {
  const rowNumber = sheetRowNumber(row);
  if (!rowNumber || rowNumber < 2) return;
  updates.push({ rowNumber, values });
}

export async function buildProcessLeadPlan(rows: ExcelRow[]): Promise<ProcessLeadPlan> {
  const plan: ProcessLeadPlan = {
    demoScheduledRows: [],
    rescheduleRows: [],
    demoDoneRows: [],
    statusOnlyRows: [],
    invalidRows: [],
    skippedRows: [],
    timeConflictRows: [],
    timeConflictGroups: [],
    meetingRecipients: [],
    thankYouRecipients: [],
    estimatedTime: estimateProcessingTime(0, 0, 0),
    summary: {
      total: rows.length,
      demoScheduled: 0,
      reschedule: 0,
      demoDone: 0,
      statusOnly: 0,
      invalid: 0,
      skipped: 0,
      timeConflicts: 0,
      actionable: 0
    }
  };

  const timeConflictGroups = findTimeConflictGroups(rows);
  if (timeConflictGroups.length > 0) {
    const conflictRowIds = new Set(timeConflictGroups.flatMap((group) => group.rowIds));
    plan.timeConflictGroups = timeConflictGroups;
    plan.timeConflictRows = rows
      .filter((row) => conflictRowIds.has(row.id))
      .map((row) => ({
        row: failureRow(row, TIME_CONFLICT_REMARK),
        reason: TIME_CONFLICT_REMARK
      }));
    plan.invalidRows = plan.timeConflictRows;
    plan.summary.invalid = plan.invalidRows.length;
    plan.summary.timeConflicts = plan.timeConflictRows.length;
    plan.summary.actionable = 0;
    return plan;
  }

  for (const row of rows) {
    const normalized = normalizeLeadStatus(row.lead_status);

    if (!normalized) {
      plan.invalidRows.push({
        row: failureRow(row, 'Invalid lead_status value.'),
        reason: 'Invalid lead_status value.'
      });
      continue;
    }

    if (normalized === LEAD_STATUS.DEMO_SCHEDULED) {
      if (hasGoogleMeetLink(row['Meeting Details'])) {
        plan.skippedRows.push({
          row: {
            ...row,
            lead_status: LEAD_STATUS.DEMO_SCHEDULED,
            Remarks: row.Remarks || 'Already has Google Meet link'
          },
          reason: 'Already has Google Meet link'
        });
        continue;
      }

      const validationError = validateDemoScheduledRow(row);
      if (validationError) {
        plan.invalidRows.push({ row: failureRow(row, validationError), reason: validationError });
        continue;
      }

      if (await hasEmailBeenSent(row, EMAIL_LOG_TYPES.DEMO_SCHEDULED)) {
        const dbLink = await findScheduledMeetLinkFromDb(row);
        plan.skippedRows.push({
          row: {
            ...row,
            'Meeting Details': dbLink || row['Meeting Details'] || '',
            lead_status: LEAD_STATUS.DEMO_SCHEDULED,
            Remarks: 'Already sent, skipped duplicate'
          },
          reason: 'Already sent, skipped duplicate'
        });
        continue;
      }

      const existingDbRecord = await findLeadSchedule(row);
      if (
        (existingDbRecord?.status === LEAD_STATUS.DEMO_SCHEDULED ||
          existingDbRecord?.status === 'Scheduled') &&
        existingDbRecord.meetingLink
      ) {
        plan.skippedRows.push({
          row: {
            ...row,
            'Meeting Details': existingDbRecord.meetingLink,
            lead_status: LEAD_STATUS.DEMO_SCHEDULED,
            Remarks: 'Already scheduled from database'
          },
          reason: 'Already scheduled from database'
        });
        continue;
      }

      plan.demoScheduledRows.push({ ...row, lead_status: LEAD_STATUS.DEMO_SCHEDULED });
      if (row.email) plan.meetingRecipients.push(String(row.email));
      continue;
    }

    if (normalized === LEAD_STATUS.DEMO_DONE) {
      const validationError = validateDemoDoneRow(row);
      if (validationError) {
        plan.invalidRows.push({ row: failureRow(row, validationError), reason: validationError });
        continue;
      }

      if (await hasEmailBeenSent(row, EMAIL_LOG_TYPES.DEMO_DONE_THANK_YOU)) {
        plan.skippedRows.push({
          row: {
            ...row,
            lead_status: LEAD_STATUS.DEMO_DONE,
            Remarks: 'Already sent, skipped duplicate'
          },
          reason: 'Already sent, skipped duplicate'
        });
        continue;
      }

      plan.demoDoneRows.push({ ...row, lead_status: LEAD_STATUS.DEMO_DONE });
      if (row.email) plan.thankYouRecipients.push(String(row.email));
      continue;
    }

    if (STATUS_ONLY_VALUES.has(normalized)) {
      plan.statusOnlyRows.push({
        ...row,
        lead_status: normalized,
        Remarks: row.Remarks || ''
      });
      continue;
    }

    plan.invalidRows.push({
      row: failureRow(row, 'Unsupported lead_status value.'),
      reason: 'Unsupported lead_status value.'
    });
  }

  plan.summary.demoScheduled = plan.demoScheduledRows.length;
  plan.summary.demoDone = plan.demoDoneRows.length;
  plan.summary.statusOnly = plan.statusOnlyRows.length;
  plan.summary.invalid = plan.invalidRows.length;
  plan.summary.skipped = plan.skippedRows.length;
  plan.summary.actionable =
    plan.summary.demoScheduled + plan.summary.demoDone + plan.summary.statusOnly;
  plan.estimatedTime = estimateProcessingTime(
    plan.summary.demoScheduled,
    plan.summary.demoDone,
    plan.summary.statusOnly
  );

  return plan;
}

export async function processLeadsByStatus(
  rows: ExcelRow[],
  context: SheetContext
): Promise<ProcessLeadsResult> {
  const plan = await buildProcessLeadPlan(rows);
  const resultsById = new Map<string, ExcelRow>();
  const sheetUpdates: Array<{ rowNumber: number; values: Record<string, any> }> = [];
  const summary: ProcessLeadsResult['summary'] = {
    total: rows.length,
    demoScheduled: 0,
    reschedule: 0,
    demoDone: 0,
    statusOnly: 0,
    failed: plan.invalidRows.length,
    skipped: plan.skippedRows.length,
    timeConflicts: plan.summary.timeConflicts
  };

  if (plan.summary.timeConflicts > 0) {
    const conflictRowsById = new Map(plan.timeConflictRows.map((item) => [item.row.id, item.row]));
    return {
      rows: rows.map((row) => conflictRowsById.get(row.id) || row),
      summary
    };
  }

  for (const item of plan.invalidRows) {
    resultsById.set(item.row.id, item.row);
    collectSheetUpdate(sheetUpdates, item.row, {
      lead_status: item.row.lead_status || '',
      Remarks: item.row.Remarks || item.reason || ''
    });
  }

  for (const item of plan.skippedRows) {
    resultsById.set(item.row.id, item.row);
    collectSheetUpdate(sheetUpdates, item.row, {
      'Meeting Details': item.row['Meeting Details'] || '',
      lead_status: item.row.lead_status || '',
      Remarks: item.row.Remarks || item.reason || ''
    });
  }

  for (let index = 0; index < plan.demoScheduledRows.length; index++) {
    const row = plan.demoScheduledRows[index];
    try {
      const { rows: processedRows, summary: rowSummary } = await processScheduleRows([row], {
        sheetContext: context
      });
      const processedRow = processedRows[0] || row;
      resultsById.set(row.id, processedRow);
      summary.demoScheduled += rowSummary.scheduled;
      summary.failed += rowSummary.failed;
      summary.skipped += rowSummary.skipped;
      collectSheetUpdate(sheetUpdates, processedRow, {
        'Meeting Details': processedRow['Meeting Details'] || '',
        lead_status: processedRow.lead_status || LEAD_STATUS.DEMO_SCHEDULED,
        Remarks: processedRow.Remarks || ''
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Scheduling failed.';
      const failedRow = failureRow(row, message);
      resultsById.set(row.id, failedRow);
      summary.failed++;
      collectSheetUpdate(sheetUpdates, failedRow, {
        lead_status: failedRow.lead_status || LEAD_STATUS.DEMO_SCHEDULED,
        Remarks: message
      });
    }

    if (index < plan.demoScheduledRows.length - 1 || plan.demoDoneRows.length > 0) {
      await delay(PROCESS_DELAY_MS);
    }
  }

  for (let index = 0; index < plan.demoDoneRows.length; index++) {
    const row = plan.demoDoneRows[index];
    try {
      const result = await sendThankYouForRow(row, context, { skipSheetSync: true });
      resultsById.set(row.id, result.row);
      if (result.skipped) summary.skipped++;
      else summary.demoDone++;
      collectSheetUpdate(sheetUpdates, result.row, {
        lead_status: result.row.lead_status || LEAD_STATUS.DEMO_DONE,
        Remarks: result.row.Remarks || result.message || ''
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Thank-you email failed.';
      const failedRow = failureRow(row, message);
      resultsById.set(row.id, failedRow);
      summary.failed++;
      collectSheetUpdate(sheetUpdates, failedRow, {
        lead_status: failedRow.lead_status || LEAD_STATUS.DEMO_DONE,
        Remarks: message
      });
    }

    if (index < plan.demoDoneRows.length - 1) {
      await delay(PROCESS_DELAY_MS);
    }
  }

  for (const row of plan.statusOnlyRows) {
    try {
      const updatedRow = await updateLeadStatusOnly(
        row,
        String(row.lead_status || ''),
        context,
        row.Remarks,
        { skipSheetSync: true }
      );
      resultsById.set(row.id, updatedRow);
      summary.statusOnly++;
      collectSheetUpdate(sheetUpdates, updatedRow, {
        lead_status: updatedRow.lead_status || '',
        Remarks: updatedRow.Remarks || ''
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Status update failed.';
      const failedRow = failureRow(row, message);
      resultsById.set(row.id, failedRow);
      summary.failed++;
      collectSheetUpdate(sheetUpdates, failedRow, {
        lead_status: failedRow.lead_status || '',
        Remarks: message
      });
    }
  }

  if (
    context.sourceType === 'google-sheet' &&
    context.spreadsheetId &&
    context.sheetName &&
    context.headers?.length
  ) {
    await updateGoogleSheetRowsBatch(
      context.spreadsheetId,
      context.sheetName,
      context.headers,
      sheetUpdates
    );
  }

  return {
    rows: rows.map((row) => resultsById.get(row.id) || row),
    summary
  };
}

export async function syncSheetRow(
  row: ExcelRow,
  context: SheetContext,
  updates: Record<string, string>,
  includeMeetingDetails = false
) {
  if (context.sourceType !== 'google-sheet') return;
  if (!context.spreadsheetId || !context.sheetName || !context.headers?.length) return;

  const sheetRowNumber = Number(row.__sheetRowNumber || row.__sourceRowNumber);
  if (!sheetRowNumber || sheetRowNumber < 2) return;

  const payload: Record<string, string> = {
    lead_status: updates.lead_status ?? '',
    Remarks: updates.Remarks ?? ''
  };

  if (includeMeetingDetails && updates['Meeting Details'] !== undefined) {
    payload['Meeting Details'] = updates['Meeting Details'];
  }

  await updateGoogleSheetRow(
    context.spreadsheetId,
    context.sheetName,
    sheetRowNumber,
    context.headers,
    payload
  );
}

export async function sendThankYouForRow(
  row: ExcelRow,
  context: SheetContext,
  options: WorkflowOptions = {}
) {
  const email = String(row.email || '').trim();
  if (!email) throw new Error('Email is missing.');
  if (!isValidEmail(email)) throw new Error('Email is invalid.');

  if (await hasEmailBeenSent(row, EMAIL_LOG_TYPES.DEMO_DONE_THANK_YOU)) {
    const updatedRow: ExcelRow = {
      ...row,
      lead_status: LEAD_STATUS.DEMO_DONE,
      Remarks: 'Thank-you email already sent'
    };
    if (!options.skipSheetSync) {
      await syncSheetRow(row, context, {
        lead_status: LEAD_STATUS.DEMO_DONE,
        Remarks: updatedRow.Remarks || ''
      });
    }
    return { row: updatedRow, skipped: true, message: 'Thank-you email already sent' };
  }

  const inviteResult = await sendThankYouEmail(row);
  await logEmailSent(row, EMAIL_LOG_TYPES.DEMO_DONE_THANK_YOU, { messageId: inviteResult.messageId });

  const keys = { email, dateOfDemo: String(row['Date of Demo'] || ''), timeOfDemo: String(row['Time of Demo'] || '') };
  if (keys.email && keys.dateOfDemo && keys.timeOfDemo) {
    await saveLeadScheduleSuccess(
      row,
      {
        meetingLink: String(row['Meeting Details'] || ''),
        gmailMessageId: inviteResult.messageId,
        remarks: 'Thank-you email sent',
        status: LEAD_STATUS.DEMO_DONE
      },
      { sourceType: context.sourceType, sourceId: context.spreadsheetId }
    );
  }

  const updatedRow: ExcelRow = {
    ...row,
    lead_status: LEAD_STATUS.DEMO_DONE,
    Remarks: 'Thank-you email sent'
  };

  if (!options.skipSheetSync) {
    await syncSheetRow(row, context, {
      lead_status: LEAD_STATUS.DEMO_DONE,
      Remarks: 'Thank-you email sent'
    });
  }

  return { row: updatedRow, skipped: false, message: 'Thank-you email sent' };
}

export async function updateLeadStatusOnly(
  row: ExcelRow,
  status: string,
  context: SheetContext,
  remarks?: string,
  options: WorkflowOptions = {}
) {
  const normalized = normalizeLeadStatus(status);
  if (!normalized) throw new Error('Invalid lead_status value.');

  const updatedRow: ExcelRow = {
    ...row,
    lead_status: normalized,
    Remarks: remarks ?? row.Remarks ?? ''
  };

  if (!options.skipSheetSync) {
    await syncSheetRow(row, context, {
      lead_status: normalized,
      Remarks: updatedRow.Remarks || ''
    });
  }

  await saveLeadStatusUpdate(
    updatedRow,
    {
      status: normalized,
      remarks: updatedRow.Remarks || ''
    },
    {
      sourceType: context.sourceType,
      sourceId: context.spreadsheetId
    }
  );

  return updatedRow;
}

export async function processScheduleRows(
  rows: ExcelRow[],
  options?: {
    onRowProcessed?: (row: ExcelRow, index: number) => Promise<void>;
    sheetContext?: SheetContext;
  }
) {
  const results: ExcelRow[] = [];
  const summary: ScheduleSummary = {
    totalRows: rows.length,
    scheduled: 0,
    failed: 0,
    skipped: 0
  };

  const timeConflictGroups = findTimeConflictGroups(rows);
  if (timeConflictGroups.length > 0) {
    const conflictRowIds = new Set(timeConflictGroups.flatMap((group) => group.rowIds));
    const conflictRows = rows.map((row) =>
      conflictRowIds.has(row.id) ? failureRow(row, TIME_CONFLICT_REMARK) : row
    );
    return {
      rows: conflictRows,
      summary: {
        ...summary,
        failed: conflictRows.filter((row) => row.__schedulerStatus === 'Failed').length,
        timeConflicts: conflictRowIds.size
      }
    };
  }

  const validateScheduleDateTime = (dateValue: unknown, timeValue: unknown) => {
    const startTime = parseExcelDateTime(dateValue, timeValue);
    if (startTime.getTime() <= Date.now()) {
      throw new Error('Meeting date/time is in the past. Choose a future Date of Demo and Time of Demo.');
    }
    return startTime;
  };

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const rowEmail = row.email || 'missing-email';
    console.log(`Processing row ${index + 1}/${rows.length}: ${rowEmail}`);

    const logResult = (result: 'Scheduled' | 'Failed' | 'Skipped') => {
      console.log(`Result: ${result}`);
    };

    const existingMeetLink = hasGoogleMeetLink(row['Meeting Details'])
      ? String(row['Meeting Details'])
      : '';

    if (hasGoogleMeetLink(existingMeetLink)) {
      const updatedRow: ExcelRow = {
        ...row,
        'Meeting Details': existingMeetLink,
        lead_status: LEAD_STATUS.DEMO_SCHEDULED,
        Remarks: row.Remarks || 'Already has Google Meet link'
      };
      results.push(updatedRow);
      summary.skipped++;
      logResult('Skipped');
      await options?.onRowProcessed?.(updatedRow, index);
      if (index < rows.length - 1) await delay(1000);
      continue;
    }

    if (await hasEmailBeenSent(row, EMAIL_LOG_TYPES.DEMO_SCHEDULED)) {
      const dbLink = await findScheduledMeetLinkFromDb(row);
      const updatedRow: ExcelRow = {
        ...row,
        'Meeting Details': dbLink || row['Meeting Details'] || '',
        lead_status: LEAD_STATUS.DEMO_SCHEDULED,
        Remarks: 'Meeting email already sent'
      };
      results.push(updatedRow);
      summary.skipped++;
      logResult('Skipped');
      await options?.onRowProcessed?.(updatedRow, index);
      if (index < rows.length - 1) await delay(1000);
      continue;
    }

    if (!isDemoScheduledStatus(row.lead_status)) {
      results.push(row);
      summary.skipped++;
      logResult('Skipped');
      await options?.onRowProcessed?.(row, index);
      if (index < rows.length - 1) await delay(1000);
      continue;
    }

    if (!row.email || !isValidEmail(String(row.email))) {
      const updatedRow: ExcelRow = {
        ...row,
        __schedulerStatus: 'Failed',
        Remarks: 'Email is invalid. Add a valid recipient email before scheduling.'
      };
      await saveLeadScheduleFailure(updatedRow, updatedRow.Remarks || 'Email is invalid');
      results.push(updatedRow);
      summary.failed++;
      logResult('Failed');
      await options?.onRowProcessed?.(updatedRow, index);
      if (index < rows.length - 1) await delay(1000);
      continue;
    }

    try {
      validateScheduleDateTime(row['Date of Demo'], row['Time of Demo']);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Date or time is invalid.';
      const updatedRow: ExcelRow = { ...row, __schedulerStatus: 'Failed', Remarks: message };
      await saveLeadScheduleFailure(updatedRow, message);
      results.push(updatedRow);
      summary.failed++;
      logResult('Failed');
      await options?.onRowProcessed?.(updatedRow, index);
      if (index < rows.length - 1) await delay(1000);
      continue;
    }

    const existingDbRecord = await findLeadSchedule(row);
    if (
      (existingDbRecord?.status === LEAD_STATUS.DEMO_SCHEDULED ||
        existingDbRecord?.status === 'Scheduled') &&
      existingDbRecord.meetingLink
    ) {
      const updatedRow: ExcelRow = {
        ...row,
        'Meeting Details': existingDbRecord.meetingLink,
        lead_status: LEAD_STATUS.DEMO_SCHEDULED,
        Remarks: 'Already scheduled from database'
      };
      results.push(updatedRow);
      summary.skipped++;
      logResult('Skipped');
      await options?.onRowProcessed?.(updatedRow, index);
      if (index < rows.length - 1) await delay(1000);
      continue;
    }

    try {
      const scheduleResult = await scheduleMeeting(row);
      const meetLink = scheduleResult.meetLink;

      let inviteSent = true;
      let inviteError = '';
      let gmailMessageId = '';
      try {
        const inviteResult = await sendGmailInvite(row, meetLink);
        gmailMessageId = inviteResult.messageId;
        await logEmailSent(row, EMAIL_LOG_TYPES.DEMO_SCHEDULED, { messageId: gmailMessageId });
      } catch (err: unknown) {
        inviteSent = false;
        inviteError = err instanceof Error ? err.message : 'Gmail invitation failed.';
        await logEmailSent(row, EMAIL_LOG_TYPES.DEMO_SCHEDULED, { error: inviteError });
      }

      const remarks = inviteSent
        ? 'Meeting scheduled and email sent'
        : `Meet link created, but email failed: ${inviteError}`;

      const updatedRow: ExcelRow = {
        ...row,
        'Meeting Details': meetLink,
        lead_status: LEAD_STATUS.DEMO_SCHEDULED,
        Remarks: remarks
      };

      await saveLeadScheduleSuccess(
        updatedRow,
        {
          meetingLink: meetLink,
          calendarEventId: scheduleResult.eventId,
          gmailMessageId,
          remarks,
          status: LEAD_STATUS.DEMO_SCHEDULED
        },
        {
          sourceType: options?.sheetContext?.sourceType || row.__sourceType,
          sourceId: options?.sheetContext?.spreadsheetId || row.__spreadsheetId
        }
      );

      addScheduledReminder(updatedRow, meetLink, scheduleResult.startTime);
      results.push(updatedRow);
      summary.scheduled++;
      logResult('Scheduled');
      await options?.onRowProcessed?.(updatedRow, index);
    } catch (err: unknown) {
      const failureMessage =
        err instanceof Error ? err.message : 'Scheduling failed: Google API transaction did not complete.';
      const updatedRow: ExcelRow = { ...row, __schedulerStatus: 'Failed', Remarks: failureMessage };
      await saveLeadScheduleFailure(updatedRow, failureMessage);
      results.push(updatedRow);
      summary.failed++;
      logResult('Failed');
      await options?.onRowProcessed?.(updatedRow, index);
    }

    if (index < rows.length - 1) await delay(1000);
  }

  return { rows: results, summary };
}
