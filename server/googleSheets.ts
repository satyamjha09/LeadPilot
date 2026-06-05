import { google } from 'googleapis';
import { ExcelRow } from '../src/types';
import { getOAuthClient } from './googleAuth';
import { LEAD_STATUS, isValidLeadStatus, normalizeLeadStatus } from './leadStatus';

const REQUIRED_UPDATE_COLUMNS = ['Meeting Details', 'lead_status', 'Remarks'];
const SHEET_BATCH_SIZE = 20;

const FIELD_KEYS: Record<string, string[]> = {
  full_name: ['full_name', 'Full Name', 'Name', 'client_name', 'Client Name', 'lead_name', 'Lead Name', 'Lead', 'Client'],
  email: ['email', 'Email', 'email_address', 'Email Address', 'mail', 'contact_email', 'Contact Email'],
  'Date of Demo': ['Date of Demo', 'date_of_demo', 'Date', 'demo_date', 'Demo Date', 'schedule_date', 'Schedule Date', 'meeting_date', 'Meeting Date'],
  'Time of Demo': ['Time of Demo', 'time_of_demo', 'Time', 'demo_time', 'Demo Time', 'schedule_time', 'Schedule Time', 'meeting_time', 'Meeting Time'],
  'Meeting Details': ['Meeting Details', 'meeting_details', 'Meet Link', 'Google Meet', 'Google Meet Link', 'meeting_link'],
  lead_status: ['lead_status', 'Lead Status', 'Status', 'status'],
  Remarks: ['Remarks', 'remarks', 'Notes', 'notes', 'Error', 'error']
};

export function extractSheetInfo(sheetUrl: string) {
  const spreadsheetId = String(sheetUrl || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (!spreadsheetId) {
    throw new Error('Invalid Google Sheets URL');
  }

  let gid: string | undefined;
  try {
    const parsedUrl = new URL(sheetUrl);
    gid = parsedUrl.searchParams.get('gid') || parsedUrl.hash.match(/gid=([^&]+)/)?.[1] || undefined;
  } catch {
    gid = String(sheetUrl).match(/[?#&]gid=([^&]+)/)?.[1];
  }

  return { spreadsheetId, gid };
}

export function getSheetsClient() {
  const oauth2Client = getOAuthClient();
  return google.sheets({ version: 'v4', auth: oauth2Client });
}

export async function getSheetTitleByGid(spreadsheetId: string, gid?: string) {
  const sheets = getSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetTabs = spreadsheet.data.sheets || [];

  if (sheetTabs.length === 0) {
    throw new Error('Spreadsheet has no sheet tabs');
  }

  if (gid) {
    const matchedSheet = sheetTabs.find(sheet => sheet.properties?.sheetId === Number(gid));
    if (!matchedSheet?.properties?.title) {
      throw new Error('Could not find sheet tab for gid');
    }
    return matchedSheet.properties.title;
  }

  const firstTitle = sheetTabs[0]?.properties?.title;
  if (!firstTitle) {
    throw new Error('Spreadsheet has no readable sheet title');
  }

  return firstTitle;
}

export async function readSheetRows(spreadsheetId: string, sheetName: string) {
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A:Z`
  });

  const values = response.data.values || [];
  const headers = (values[0] || []).map(value => String(value || '').trim());
  if (headers.length === 0 || headers.every(header => !header)) {
    throw new Error('The selected Google Sheet tab needs headers in row 1');
  }

  const rows = values.slice(1).map((valuesRow, index) => {
    const sheetRowNumber = index + 2;
    const rawRow: Record<string, any> = {};

    headers.forEach((header, columnIndex) => {
      if (header) {
        rawRow[header] = valuesRow[columnIndex] ?? '';
      }
    });

    const fullName = stringValue(findFlexibleValue(rawRow, FIELD_KEYS.full_name));
    const email = stringValue(findFlexibleValue(rawRow, FIELD_KEYS.email));
    const dateDemo = stringValue(findFlexibleValue(rawRow, FIELD_KEYS['Date of Demo']));
    const timeDemo = stringValue(findFlexibleValue(rawRow, FIELD_KEYS['Time of Demo']));
    const meetingDetails = stringValue(findFlexibleValue(rawRow, FIELD_KEYS['Meeting Details']));
    const rawLeadStatus = stringValue(findFlexibleValue(rawRow, FIELD_KEYS.lead_status));
    let leadStatus = normalizeLeadStatus(rawLeadStatus) || rawLeadStatus;
    let remarks = stringValue(findFlexibleValue(rawRow, FIELD_KEYS.Remarks));
    let schedulerStatus: ExcelRow['__schedulerStatus'] = undefined;

    if (!leadStatus) {
      leadStatus = LEAD_STATUS.FOLLOW_UP;
    }

    if (hasGoogleMeetLink(meetingDetails)) {
      leadStatus = LEAD_STATUS.DEMO_SCHEDULED;
      if (!remarks) remarks = 'Already has Google Meet link';
    } else if (leadStatus === LEAD_STATUS.DEMO_SCHEDULED) {
      if (!email) {
        schedulerStatus = 'Failed';
        remarks = 'Email is missing';
      } else if (!isValidEmail(email)) {
        schedulerStatus = 'Failed';
        remarks = 'Email is invalid';
      } else if (!dateDemo) {
        schedulerStatus = 'Failed';
        remarks = 'Date of Demo is missing';
      } else if (!timeDemo) {
        schedulerStatus = 'Failed';
        remarks = 'Time of Demo is missing';
      }
    } else if (leadStatus === LEAD_STATUS.DEMO_DONE) {
      if (!email) {
        schedulerStatus = 'Failed';
        remarks = 'Email is missing';
      } else if (!isValidEmail(email)) {
        schedulerStatus = 'Failed';
        remarks = 'Email is invalid';
      }
    } else if (!isValidLeadStatus(leadStatus)) {
      schedulerStatus = 'Failed';
      remarks = 'Invalid lead_status value';
    }

    return {
      ...rawRow,
      id: `sheet-row-${sheetRowNumber}`,
      __sheetRowNumber: sheetRowNumber,
      __originalColumns: headers,
      __sourceType: 'google-sheet',
      __spreadsheetId: spreadsheetId,
      __sheetName: sheetName,
      full_name: fullName,
      email,
      'Date of Demo': dateDemo,
      'Time of Demo': timeDemo,
      'Meeting Details': meetingDetails,
      lead_status: leadStatus as any,
      __schedulerStatus: schedulerStatus,
      Remarks: remarks
    } satisfies ExcelRow;
  });

  return { headers, rows };
}

export async function ensureRequiredColumns(spreadsheetId: string, sheetName: string, headers: string[]) {
  const sheets = getSheetsClient();
  const updatedHeaders = [...headers];
  let changed = false;

  for (const requiredColumn of REQUIRED_UPDATE_COLUMNS) {
    if (!updatedHeaders.some(header => header.trim().toLowerCase() === requiredColumn.toLowerCase())) {
      updatedHeaders.push(requiredColumn);
      changed = true;
    }
  }

  if (changed) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteSheetName(sheetName)}!A1:${columnLetter(updatedHeaders.length)}1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [updatedHeaders] }
    });
  }

  return {
    headers: updatedHeaders,
    columnIndexMap: buildColumnIndexMap(updatedHeaders)
  };
}

export async function updateGoogleSheetRow(
  spreadsheetId: string,
  sheetName: string,
  rowNumber: number,
  headers: string[],
  updates: Record<string, any>
) {
  await updateGoogleSheetRowsBatch(spreadsheetId, sheetName, headers, [
    { rowNumber, values: updates }
  ]);
}

export async function updateGoogleSheetRowsBatch(
  spreadsheetId: string,
  sheetName: string,
  headers: string[],
  updates: Array<{ rowNumber: number; values: Record<string, any> }>
) {
  if (!updates.length) return;

  const sheets = getSheetsClient();
  const columnIndexMap = buildColumnIndexMap(headers);
  const validUpdates = updates.filter((update) => update.rowNumber >= 2);

  for (let start = 0; start < validUpdates.length; start += SHEET_BATCH_SIZE) {
    const chunk = validUpdates.slice(start, start + SHEET_BATCH_SIZE);
    const data = chunk.flatMap((update) =>
      Object.entries(update.values)
        .filter(([columnName]) => REQUIRED_UPDATE_COLUMNS.includes(columnName))
        .map(([columnName, value]) => {
          const columnNumber = columnIndexMap[columnName];
          if (!columnNumber) return null;
          return {
            range: `${quoteSheetName(sheetName)}!${columnLetter(columnNumber)}${update.rowNumber}`,
            values: [[value ?? '']]
          };
        })
        .filter((item): item is { range: string; values: any[][] } => !!item)
    );

    if (data.length === 0) continue;

    await retrySheetsBatchUpdate(async () => {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data
        }
      });
    });

    if (start + SHEET_BATCH_SIZE < validUpdates.length) {
      await delay(2000);
    }
  }
}

async function retrySheetsBatchUpdate(operation: () => Promise<void>) {
  const waits = [2000, 4000, 8000];

  for (let attempt = 0; attempt <= waits.length; attempt++) {
    try {
      await operation();
      return;
    } catch (err: any) {
      const status = err?.code || err?.response?.status;
      if (status !== 429 || attempt === waits.length) {
        throw err;
      }
      await delay(waits[attempt]);
    }
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function friendlySheetsError(err: any) {
  const status = err?.code || err?.response?.status;
  const detail = err?.response?.data?.error?.message || err?.message || '';

  if (/Invalid Google Sheets URL/i.test(detail)) {
    return { status: 400, message: 'Invalid Google Sheets URL' };
  }
  if (status === 401 || /No access, refresh token/i.test(detail)) {
    return { status: 401, message: 'Google account is not connected' };
  }
  if (status === 403 && /insufficient|scope|permission/i.test(detail)) {
    return { status: 403, message: 'Google Sheets permission missing. Reconnect Google with spreadsheets scope.' };
  }
  if (status === 403 || status === 404) {
    return { status: status || 403, message: 'Connected Google account does not have access to this sheet' };
  }

  return { status: 500, message: detail || 'Google Sheets request failed' };
}

function findFlexibleValue(row: Record<string, any>, possibleKeys: string[]) {
  for (const key of possibleKeys) {
    if (row[key] !== undefined) return row[key];
    const matchedKey = Object.keys(row).find(rowKey => rowKey.trim().toLowerCase() === key.toLowerCase());
    if (matchedKey) return row[matchedKey];
  }
  return '';
}

function stringValue(value: any) {
  return String(value ?? '').trim();
}

function hasGoogleMeetLink(value: any) {
  return /meet\.google\.com/i.test(String(value || ''));
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildColumnIndexMap(headers: string[]) {
  return REQUIRED_UPDATE_COLUMNS.reduce<Record<string, number>>((acc, columnName) => {
    const index = headers.findIndex(header => header.trim().toLowerCase() === columnName.toLowerCase());
    acc[columnName] = index + 1;
    return acc;
  }, {});
}

function quoteSheetName(sheetName: string) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

function columnLetter(columnNumber: number) {
  let letter = '';
  while (columnNumber > 0) {
    const remainder = (columnNumber - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    columnNumber = Math.floor((columnNumber - 1) / 26);
  }
  return letter;
}
