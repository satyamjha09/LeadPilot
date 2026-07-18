import { randomUUID } from 'node:crypto';
import { prisma } from './db';
import type { EmailBrandKey } from '../src/lib/emailBrand';

const SHEET_SYNC_DELAYS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];

function nextDelayMs(nextRetryCount: number) {
  return SHEET_SYNC_DELAYS_MS[Math.min(Math.max(nextRetryCount, 1), SHEET_SYNC_DELAYS_MS.length) - 1];
}

function jobKey(input: { spreadsheetId: string; sheetName: string; rowNumber: number }) {
  return [input.spreadsheetId, input.sheetName, input.rowNumber].join('|');
}

export async function enqueueSheetSyncJob(input: {
  spreadsheetId: string;
  sheetName: string;
  rowNumber: number;
  headers: string[];
  values: Record<string, any>;
  emailBrand: EmailBrandKey;
  emailDeliveryId?: string;
  error?: unknown;
}) {
  const now = new Date();
  const errorMessage = input.error instanceof Error ? input.error.message : String(input.error || 'Google Sheet sync failed');
  const emailBrand = input.emailBrand;
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "SheetSyncJob" (
      "id",
      "jobKey",
      "emailBrand",
      "spreadsheetId",
      "sheetName",
      "rowNumber",
      "headersJson",
      "valuesJson",
      "emailDeliveryId",
      "status",
      "retryCount",
      "maxRetries",
      "nextRetryAt",
      "lastError",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${id},
      ${jobKey(input)},
      ${emailBrand},
      ${input.spreadsheetId},
      ${input.sheetName},
      ${input.rowNumber},
      ${JSON.stringify(input.headers)},
      ${JSON.stringify(input.values)},
      ${input.emailDeliveryId || null},
      'PENDING',
      ${0},
      ${3},
      ${new Date(Date.now() + SHEET_SYNC_DELAYS_MS[0])},
      ${errorMessage.slice(0, 2000)},
      ${now},
      ${now}
    )
    ON CONFLICT ("emailBrand", "jobKey") DO UPDATE SET
      "headersJson" = EXCLUDED."headersJson",
      "valuesJson" = EXCLUDED."valuesJson",
      "emailDeliveryId" = EXCLUDED."emailDeliveryId",
      "status" = 'PENDING',
      "nextRetryAt" = EXCLUDED."nextRetryAt",
      "lastError" = EXCLUDED."lastError",
      "updatedAt" = EXCLUDED."updatedAt"
  `;
}

export async function listDueSheetSyncJobs(limit = 10) {
  return prisma.$queryRaw<
    Array<{
      id: string;
      emailBrand: EmailBrandKey;
      spreadsheetId: string;
      sheetName: string;
      rowNumber: number;
      headersJson: string;
      valuesJson: string;
      emailDeliveryId: string | null;
      retryCount: number;
      maxRetries: number;
    }>
  >`
    SELECT
      "id",
      "emailBrand",
      "spreadsheetId",
      "sheetName",
      "rowNumber",
      "headersJson",
      "valuesJson",
      "emailDeliveryId",
      "retryCount",
      "maxRetries"
    FROM "SheetSyncJob"
    WHERE "status" = 'PENDING'
      AND "nextRetryAt" <= NOW()
    ORDER BY "nextRetryAt" ASC
    LIMIT ${limit}
  `;
}

export async function listSheetSyncJobsForRow(input: {
  emailBrand: EmailBrandKey;
  spreadsheetId: string;
  sheetName: string;
  rowNumber: number;
}) {
  return prisma.$queryRaw<
    Array<{
      id: string;
      emailBrand: EmailBrandKey;
      spreadsheetId: string;
      sheetName: string;
      rowNumber: number;
      headersJson: string;
      valuesJson: string;
      emailDeliveryId: string | null;
      status: string;
      retryCount: number;
      maxRetries: number;
      nextRetryAt: Date | null;
      lastError: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>
  >`
    SELECT
      "id",
      "emailBrand",
      "spreadsheetId",
      "sheetName",
      "rowNumber",
      "headersJson",
      "valuesJson",
      "emailDeliveryId",
      "status",
      "retryCount",
      "maxRetries",
      "nextRetryAt",
      "lastError",
      "createdAt",
      "updatedAt"
    FROM "SheetSyncJob"
    WHERE "emailBrand" = ${input.emailBrand}
      AND "spreadsheetId" = ${input.spreadsheetId}
      AND "sheetName" = ${input.sheetName}
      AND "rowNumber" = ${input.rowNumber}
    ORDER BY "updatedAt" DESC
  `;
}

export async function findSheetSyncJobById(jobId: string) {
  const [job] = await prisma.$queryRaw<
    Array<{
      id: string;
      emailBrand: EmailBrandKey;
      spreadsheetId: string;
      sheetName: string;
      rowNumber: number;
      headersJson: string;
      valuesJson: string;
      emailDeliveryId: string | null;
      status: string;
      retryCount: number;
      maxRetries: number;
      nextRetryAt: Date | null;
      lastError: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>
  >`
    SELECT
      "id",
      "emailBrand",
      "spreadsheetId",
      "sheetName",
      "rowNumber",
      "headersJson",
      "valuesJson",
      "emailDeliveryId",
      "status",
      "retryCount",
      "maxRetries",
      "nextRetryAt",
      "lastError",
      "createdAt",
      "updatedAt"
    FROM "SheetSyncJob"
    WHERE "id" = ${jobId}
    LIMIT 1
  `;
  return job || null;
}

export async function markSheetSyncJobRetryNow(jobId: string) {
  await prisma.$executeRaw`
    UPDATE "SheetSyncJob"
    SET
      "status" = 'PENDING',
      "nextRetryAt" = ${new Date()},
      "updatedAt" = ${new Date()}
    WHERE "id" = ${jobId}
      AND "status" IN ('PENDING', 'FAILED')
  `;
}

export async function markSheetSyncJobSucceeded(jobId: string) {
  await prisma.$executeRaw`
    UPDATE "SheetSyncJob"
    SET
      "status" = 'SYNCED',
      "lastError" = NULL,
      "updatedAt" = ${new Date()}
    WHERE "id" = ${jobId}
  `;
}

export async function markSheetSyncJobFailed(jobId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Google Sheet sync failed');
  const [job] = await prisma.$queryRaw<Array<{ retryCount: number; maxRetries: number }>>`
    SELECT "retryCount", "maxRetries" FROM "SheetSyncJob" WHERE "id" = ${jobId}
  `;
  const nextRetryCount = (job?.retryCount ?? 0) + 1;
  const maxRetries = job?.maxRetries ?? 3;
  const status = nextRetryCount <= maxRetries ? 'PENDING' : 'FAILED';
  const nextRetryAt = nextRetryCount <= maxRetries ? new Date(Date.now() + nextDelayMs(nextRetryCount)) : new Date();

  await prisma.$executeRaw`
    UPDATE "SheetSyncJob"
    SET
      "status" = ${status},
      "retryCount" = ${nextRetryCount},
      "nextRetryAt" = ${nextRetryAt},
      "lastError" = ${message.slice(0, 2000)},
      "updatedAt" = ${new Date()}
    WHERE "id" = ${jobId}
  `;
}
