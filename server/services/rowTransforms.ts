import { ExcelRow } from '../../src/types';
import { parseExcelDateTime } from '../googleAuth';
import { getLeadStatusParse, LEAD_STATUS, normalizeHeader, normalizeLeadStatus } from '../leadStatus';
import { findScheduledMeetLinkFromDb } from '../scheduleDb';
import { hasGoogleMeetLink, isValidEmail } from '../leadWorkflow';
import { normalizeDisplayDate } from '../../src/lib/dateFormat';

const validationRemark = (field: string) => `${field} is missing. Add it in the Excel row before scheduling.`;

function findValueInRow(row: Record<string, any>, possibleKeys: string[]): any {
  const normalizedRow = new Map(Object.keys(row).map((rowKey) => [normalizeHeader(rowKey), rowKey]));
  for (const key of possibleKeys) {
    if (row[key] !== undefined) return row[key];
    const matchedKey = normalizedRow.get(normalizeHeader(key));
    if (matchedKey) return row[matchedKey];
  }
  return undefined;
}

function validateScheduleDateTime(dateValue: any, timeValue: any) {
  const startTime = parseExcelDateTime(dateValue, timeValue);
  if (startTime.getTime() <= Date.now()) {
    throw new Error('Meeting date/time is in the past. Choose a future Date of Demo and Time of Demo.');
  }
  return startTime;
}

function formatExcelTime(value: any) {
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
}

export async function reconcileScheduledRows(rows: ExcelRow[]) {
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
}

export function buildExportRow(row: ExcelRow) {
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
}

export function normalizeRows(rows: Record<string, any>[], options?: { idPrefix?: string; rowOffset?: number }) {
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
    dateDemo = normalizeDisplayDate(dateDemo);

    const timeDemo = formatExcelTime(findValueInRow(row, ['Time of Demo', 'time_of_demo', 'Time', 'demo_time', 'Demo Time', 'schedule_time', 'Schedule Time', 'meeting_time', 'Meeting Time']) || '');

    const meetDetails = String(
      findValueInRow(row, ['Meeting Details', 'meeting_details', 'Meet Link', 'meet_link', 'Google Meet', 'google_meet', 'Link', 'link']) || ''
    ).trim();

    const automationId = String(
      findValueInRow(row, ['automation_id', 'Automation ID', 'automation id', 'AutomationId']) || ''
    ).trim();

    const rawLeadStatus = String(
      findValueInRow(row, ['lead_status', 'Lead Status', 'lead status', 'Lead_Status', 'Status', 'status']) || ''
    ).trim();
    let leadStatus = normalizeLeadStatus(rawLeadStatus) || rawLeadStatus;
    let schedulerStatus: ExcelRow['__schedulerStatus'] = undefined;

    let remarks = String(
      findValueInRow(row, ['Remarks', 'remarks', 'Note', 'Notes', 'Diagnostic', 'diagnostics', 'Comment', 'Comments']) || ''
    ).trim();

    const hasMeetUrl = hasGoogleMeetLink(meetDetails);
    const parsedLeadStatus = getLeadStatusParse(rawLeadStatus);
    leadStatus = parsedLeadStatus.normalized || parsedLeadStatus.raw;

    if (parsedLeadStatus.isBlank) {
      schedulerStatus = 'Failed';
      remarks = 'lead_status is missing';
    } else if (!parsedLeadStatus.isKnown) {
      schedulerStatus = 'Failed';
      remarks = `Invalid lead_status: ${parsedLeadStatus.raw}`;
    } else if (leadStatus === LEAD_STATUS.DEMO_SCHEDULED && !hasMeetUrl) {
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
      automation_id: automationId,
      __schedulerStatus: schedulerStatus,
      Remarks: remarks
    };
  });

  return validatedRows;
}
