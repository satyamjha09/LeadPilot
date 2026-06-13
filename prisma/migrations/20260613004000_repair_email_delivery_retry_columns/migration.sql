ALTER TABLE "EmailDelivery"
ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "maxRetries" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "subject" TEXT,
ADD COLUMN IF NOT EXISTS "textBody" TEXT,
ADD COLUMN IF NOT EXISTS "htmlBody" TEXT,
ADD COLUMN IF NOT EXISTS "sheetSyncStatus" TEXT,
ADD COLUMN IF NOT EXISTS "sheetSyncLastError" TEXT,
ADD COLUMN IF NOT EXISTS "sheetSyncRetryAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "sheetSyncedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "EmailDelivery_nextRetryAt_idx" ON "EmailDelivery"("nextRetryAt");
CREATE INDEX IF NOT EXISTS "EmailDelivery_sheetSyncStatus_idx" ON "EmailDelivery"("sheetSyncStatus");
CREATE INDEX IF NOT EXISTS "EmailDelivery_sheetSyncRetryAt_idx" ON "EmailDelivery"("sheetSyncRetryAt");

CREATE TABLE IF NOT EXISTS "SheetSyncJob" (
  "id" TEXT NOT NULL,
  "jobKey" TEXT NOT NULL,
  "spreadsheetId" TEXT NOT NULL,
  "sheetName" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "headersJson" TEXT NOT NULL,
  "valuesJson" TEXT NOT NULL,
  "emailDeliveryId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "maxRetries" INTEGER NOT NULL DEFAULT 3,
  "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SheetSyncJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SheetSyncJob_jobKey_key" ON "SheetSyncJob"("jobKey");
CREATE INDEX IF NOT EXISTS "SheetSyncJob_status_idx" ON "SheetSyncJob"("status");
CREATE INDEX IF NOT EXISTS "SheetSyncJob_nextRetryAt_idx" ON "SheetSyncJob"("nextRetryAt");
CREATE INDEX IF NOT EXISTS "SheetSyncJob_emailDeliveryId_idx" ON "SheetSyncJob"("emailDeliveryId");
