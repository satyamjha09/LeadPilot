import { ExcelRow } from '../src/types';
import { prisma } from './db';
import { getLeadUniqueKeys, getSheetRowKey } from './scheduleDb';

export const EMAIL_LOG_TYPES = {
  DEMO_SCHEDULED: 'DEMO_SCHEDULED',
  DEMO_RESCHEDULED: 'DEMO_RESCHEDULED',
  DEMO_DONE_THANK_YOU: 'DEMO_DONE_THANK_YOU'
} as const;

export type EmailLogType = (typeof EMAIL_LOG_TYPES)[keyof typeof EMAIL_LOG_TYPES];

export function getEmailRowKey(row: ExcelRow) {
  const sheetRowKey = getSheetRowKey(row);
  if (sheetRowKey) return sheetRowKey;
  const keys = getLeadUniqueKeys(row);
  return `${keys.email}|${keys.dateOfDemo}|${keys.timeOfDemo}`;
}

export async function findEmailLog(row: ExcelRow, type: EmailLogType) {
  const keys = getLeadUniqueKeys(row);
  if (!keys.email) return null;

  const rowKey = getEmailRowKey(row);
  return prisma.emailLog.findUnique({
    where: {
      email_rowKey_type: {
        email: keys.email,
        rowKey,
        type
      }
    }
  });
}

export async function listEmailLogsForRow(row: ExcelRow) {
  const keys = getLeadUniqueKeys(row);
  if (!keys.email) return [];

  const rowKey = getEmailRowKey(row);
  return prisma.emailLog.findMany({
    where: {
      email: keys.email,
      rowKey
    },
    orderBy: {
      createdAt: 'desc'
    }
  });
}

export async function hasEmailBeenSent(row: ExcelRow, type: EmailLogType) {
  const log = await findEmailLog(row, type);
  return log?.status === 'sent';
}

export async function logEmailSent(
  row: ExcelRow,
  type: EmailLogType,
  data?: { messageId?: string; error?: string }
) {
  const keys = getLeadUniqueKeys(row);
  if (!keys.email) return null;

  const rowKey = getEmailRowKey(row);
  const status = data?.error ? 'failed' : 'sent';

  return prisma.emailLog.upsert({
    where: {
      email_rowKey_type: {
        email: keys.email,
        rowKey,
        type
      }
    },
    create: {
      email: keys.email,
      rowKey,
      type,
      status,
      messageId: data?.messageId || null,
      error: data?.error || null
    },
    update: {
      status,
      messageId: data?.messageId || null,
      error: data?.error || null
    }
  });
}
