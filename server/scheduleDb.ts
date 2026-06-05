import { ExcelRow } from '../src/types';
import { prisma } from './db';

export function normalizeLeadEmail(email: unknown) {
  return String(email || '').trim().toLowerCase();
}

export function normalizeLeadDate(dateValue: unknown) {
  if (dateValue instanceof Date) {
    return dateValue.toISOString().slice(0, 10);
  }
  return String(dateValue || '').trim();
}

export function normalizeLeadTime(timeValue: unknown) {
  return String(timeValue || '').trim();
}

export function getLeadUniqueKeys(row: ExcelRow) {
  return {
    email: normalizeLeadEmail(row.email),
    dateOfDemo: normalizeLeadDate(row['Date of Demo']),
    timeOfDemo: normalizeLeadTime(row['Time of Demo'])
  };
}

export async function findLeadSchedule(row: ExcelRow) {
  const keys = getLeadUniqueKeys(row);
  if (!keys.email || !keys.dateOfDemo || !keys.timeOfDemo) {
    return null;
  }

  return prisma.leadSchedule.findUnique({
    where: {
      email_dateOfDemo_timeOfDemo: keys
    }
  });
}

export async function saveLeadScheduleFailure(
  row: ExcelRow,
  remarks: string,
  options?: { sourceType?: string; sourceId?: string }
) {
  const keys = getLeadUniqueKeys(row);
  if (!keys.email || !keys.dateOfDemo || !keys.timeOfDemo) {
    return null;
  }

  return prisma.leadSchedule.upsert({
    where: {
      email_dateOfDemo_timeOfDemo: keys
    },
    create: {
      fullName: row.full_name || null,
      email: keys.email,
      dateOfDemo: keys.dateOfDemo,
      timeOfDemo: keys.timeOfDemo,
      status: 'Failed',
      remarks,
      sourceType: options?.sourceType || row.__sourceType || null,
      sourceId: options?.sourceId || row.__spreadsheetId || null,
      sheetRowNumber: row.__sheetRowNumber || row.__sourceRowNumber || null
    },
    update: {
      fullName: row.full_name || null,
      status: 'Failed',
      remarks,
      sourceType: options?.sourceType || row.__sourceType || null,
      sourceId: options?.sourceId || row.__spreadsheetId || null,
      sheetRowNumber: row.__sheetRowNumber || row.__sourceRowNumber || null
    }
  });
}

export async function saveLeadScheduleSuccess(
  row: ExcelRow,
  data: {
    meetingLink: string;
    calendarEventId?: string;
    gmailMessageId?: string;
    remarks: string;
    status?: string;
  },
  options?: { sourceType?: string; sourceId?: string }
) {
  const keys = getLeadUniqueKeys(row);
  if (!keys.email || !keys.dateOfDemo || !keys.timeOfDemo) return null;

  return prisma.leadSchedule.upsert({
    where: {
      email_dateOfDemo_timeOfDemo: keys
    },
    create: {
      fullName: row.full_name || null,
      email: keys.email,
      dateOfDemo: keys.dateOfDemo,
      timeOfDemo: keys.timeOfDemo,
      meetingLink: data.meetingLink,
      calendarEventId: data.calendarEventId || null,
      gmailMessageId: data.gmailMessageId || null,
      status: data.status || 'Demo Scheduled',
      remarks: data.remarks,
      sourceType: options?.sourceType || row.__sourceType || null,
      sourceId: options?.sourceId || row.__spreadsheetId || null,
      sheetRowNumber: row.__sheetRowNumber || row.__sourceRowNumber || null
    },
    update: {
      fullName: row.full_name || null,
      meetingLink: data.meetingLink,
      calendarEventId: data.calendarEventId || null,
      gmailMessageId: data.gmailMessageId || null,
      status: data.status || 'Demo Scheduled',
      remarks: data.remarks,
      sourceType: options?.sourceType || row.__sourceType || null,
      sourceId: options?.sourceId || row.__spreadsheetId || null,
      sheetRowNumber: row.__sheetRowNumber || row.__sourceRowNumber || null
    }
  });
}

export async function saveLeadStatusUpdate(
  row: ExcelRow,
  data: {
    status: string;
    remarks?: string;
  },
  options?: { sourceType?: string; sourceId?: string }
) {
  const keys = getLeadUniqueKeys(row);
  if (!keys.email || !keys.dateOfDemo || !keys.timeOfDemo) return null;

  return prisma.leadSchedule.upsert({
    where: {
      email_dateOfDemo_timeOfDemo: keys
    },
    create: {
      fullName: row.full_name || null,
      email: keys.email,
      dateOfDemo: keys.dateOfDemo,
      timeOfDemo: keys.timeOfDemo,
      meetingLink: row['Meeting Details'] || null,
      status: data.status,
      remarks: data.remarks || null,
      sourceType: options?.sourceType || row.__sourceType || null,
      sourceId: options?.sourceId || row.__spreadsheetId || null,
      sheetRowNumber: row.__sheetRowNumber || row.__sourceRowNumber || null
    },
    update: {
      fullName: row.full_name || null,
      meetingLink: row['Meeting Details'] || null,
      status: data.status,
      remarks: data.remarks || null,
      sourceType: options?.sourceType || row.__sourceType || null,
      sourceId: options?.sourceId || row.__spreadsheetId || null,
      sheetRowNumber: row.__sheetRowNumber || row.__sourceRowNumber || null
    }
  });
}

export async function findScheduledMeetLinkFromDb(row: ExcelRow) {
  const existing = await findLeadSchedule(row);
  const scheduled =
    existing?.status === 'Demo Scheduled' ||
    existing?.status === 'Scheduled';
  if (scheduled && existing.meetingLink) {
    return existing.meetingLink;
  }
  return '';
}
