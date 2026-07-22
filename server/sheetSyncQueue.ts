import { randomUUID } from 'node:crypto';
import { prisma } from './db';
import { parseEmailBrand, type EmailBrandKey } from '../src/lib/emailBrand';
import { parseSenderAccountKey, type SenderAccountKey } from '../src/lib/senderAccount';

const SHEET_SYNC_DELAYS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];
const SHEET_SYNC_STALE_LOCK_MS = Number(process.env.SHEET_SYNC_STALE_LOCK_MS || 10 * 60 * 1000);
const SHEET_SYNC_LOCK_OWNER = `sheet-sync-${process.pid}-${randomUUID()}`;

export type SheetSyncJobRecord = {
  id: string;
  workspaceKey: EmailBrandKey;
  emailBrand: EmailBrandKey;
  googleAccountKey: SenderAccountKey;
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
  lockedAt: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function nextDelayMs(nextRetryCount: number) {
  return SHEET_SYNC_DELAYS_MS[Math.min(Math.max(nextRetryCount, 1), SHEET_SYNC_DELAYS_MS.length) - 1];
}

function jobKey(input: { spreadsheetId: string; sheetName: string; rowNumber: number }) {
  return [input.spreadsheetId, input.sheetName, input.rowNumber].join('|');
}

function staleLockCutoff() {
  return new Date(Date.now() - SHEET_SYNC_STALE_LOCK_MS);
}

export async function enqueueSheetSyncJob(input: {
  spreadsheetId: string;
  sheetName: string;
  rowNumber: number;
  headers: string[];
  values: Record<string, any>;
  workspaceKey: EmailBrandKey;
  emailBrand: EmailBrandKey;
  googleAccountKey: SenderAccountKey;
  emailDeliveryId?: string;
  error?: unknown;
}) {
  const now = new Date();
  const errorMessage = input.error instanceof Error ? input.error.message : String(input.error || 'Google Sheet sync failed');
  const workspaceKey = parseEmailBrand(input.workspaceKey);
  const emailBrand = parseEmailBrand(input.emailBrand);
  const googleAccountKey = parseSenderAccountKey(input.googleAccountKey);
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "SheetSyncJob" (
      "id",
      "jobKey",
      "workspaceKey",
      "emailBrand",
      "googleAccountKey",
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
      "lockedAt",
      "lockedBy",
      "lastError",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${id},
      ${jobKey(input)},
      ${workspaceKey},
      ${emailBrand},
      ${googleAccountKey},
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
      NULL,
      NULL,
      ${errorMessage.slice(0, 2000)},
      ${now},
      ${now}
    )
    ON CONFLICT ("workspaceKey", "emailBrand", "jobKey") DO UPDATE SET
      "headersJson" = EXCLUDED."headersJson",
      "valuesJson" = EXCLUDED."valuesJson",
      "emailDeliveryId" = EXCLUDED."emailDeliveryId",
      "status" = 'PENDING',
      "retryCount" = 0,
      "nextRetryAt" = EXCLUDED."nextRetryAt",
      "lockedAt" = NULL,
      "lockedBy" = NULL,
      "lastError" = EXCLUDED."lastError",
      "updatedAt" = EXCLUDED."updatedAt"
  `;
}

export async function listDueSheetSyncJobs(limit = 10) {
  return prisma.$queryRaw<SheetSyncJobRecord[]>`
    SELECT
      "id",
      "workspaceKey",
      "emailBrand",
      "googleAccountKey",
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
      "lockedAt",
      "lockedBy",
      "lastError",
      "createdAt",
      "updatedAt"
    FROM "SheetSyncJob"
    WHERE (
      "status" = 'PENDING'
      AND "nextRetryAt" <= NOW()
    ) OR (
      "status" = 'PROCESSING'
      AND ("lockedAt" IS NULL OR "lockedAt" <= ${staleLockCutoff()})
    )
    ORDER BY "nextRetryAt" ASC NULLS FIRST, "updatedAt" ASC
    LIMIT ${limit}
  `;
}

export async function listSheetSyncJobsForRow(input: {
  workspaceKey: EmailBrandKey;
  emailBrand: EmailBrandKey;
  spreadsheetId: string;
  sheetName: string;
  rowNumber: number;
}) {
  const workspaceKey = parseEmailBrand(input.workspaceKey);
  const emailBrand = parseEmailBrand(input.emailBrand);
  return prisma.$queryRaw<SheetSyncJobRecord[]>`
    SELECT
      "id",
      "workspaceKey",
      "emailBrand",
      "googleAccountKey",
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
      "lockedAt",
      "lockedBy",
      "lastError",
      "createdAt",
      "updatedAt"
    FROM "SheetSyncJob"
    WHERE "workspaceKey" = ${workspaceKey}
      AND "emailBrand" = ${emailBrand}
      AND "spreadsheetId" = ${input.spreadsheetId}
      AND "sheetName" = ${input.sheetName}
      AND "rowNumber" = ${input.rowNumber}
    ORDER BY "updatedAt" DESC
  `;
}

export async function findSheetSyncJobById(jobId: string) {
  const [job] = await prisma.$queryRaw<SheetSyncJobRecord[]>`
    SELECT
      "id",
      "workspaceKey",
      "emailBrand",
      "googleAccountKey",
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
      "lockedAt",
      "lockedBy",
      "lastError",
      "createdAt",
      "updatedAt"
    FROM "SheetSyncJob"
    WHERE "id" = ${jobId}
    LIMIT 1
  `;
  return job || null;
}

export async function claimSheetSyncJobForProcessing(jobId: string, options: { manual?: boolean } = {}) {
  const [job] = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "SheetSyncJob"
    SET
      "status" = 'PROCESSING',
      "nextRetryAt" = NULL,
      "lockedAt" = ${new Date()},
      "lockedBy" = ${SHEET_SYNC_LOCK_OWNER},
      "updatedAt" = ${new Date()}
    WHERE "id" = ${jobId}
      AND (
        (
          "status" = 'PENDING'
          AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= NOW())
        )
        OR (
          "status" = 'PROCESSING'
          AND ("lockedAt" IS NULL OR "lockedAt" <= ${staleLockCutoff()})
        )
        OR (${Boolean(options.manual)} = true AND "status" = 'FAILED')
      )
    RETURNING "id"
  `;
  return Boolean(job);
}

export async function markSheetSyncJobRetryNow(jobId: string) {
  await prisma.$executeRaw`
    UPDATE "SheetSyncJob"
    SET
      "status" = 'PENDING',
      "nextRetryAt" = ${new Date()},
      "lockedAt" = NULL,
      "lockedBy" = NULL,
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
      "nextRetryAt" = NULL,
      "lockedAt" = NULL,
      "lockedBy" = NULL,
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
  const shouldRetry = nextRetryCount <= maxRetries;

  await prisma.$executeRaw`
    UPDATE "SheetSyncJob"
    SET
      "status" = ${shouldRetry ? 'PENDING' : 'FAILED'},
      "retryCount" = ${nextRetryCount},
      "nextRetryAt" = ${shouldRetry ? new Date(Date.now() + nextDelayMs(nextRetryCount)) : null},
      "lockedAt" = NULL,
      "lockedBy" = NULL,
      "lastError" = ${message.slice(0, 2000)},
      "updatedAt" = ${new Date()}
    WHERE "id" = ${jobId}
  `;
}
