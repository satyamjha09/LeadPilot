ALTER TABLE "EmailDelivery"
ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "maxRetries" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "nextRetryAt" TIMESTAMP(3),
ADD COLUMN "subject" TEXT,
ADD COLUMN "textBody" TEXT,
ADD COLUMN "htmlBody" TEXT,
ADD COLUMN "sheetSyncStatus" TEXT,
ADD COLUMN "sheetSyncLastError" TEXT,
ADD COLUMN "sheetSyncRetryAt" TIMESTAMP(3);

CREATE INDEX "EmailDelivery_nextRetryAt_idx" ON "EmailDelivery"("nextRetryAt");
CREATE INDEX "EmailDelivery_sheetSyncStatus_idx" ON "EmailDelivery"("sheetSyncStatus");
CREATE INDEX "EmailDelivery_sheetSyncRetryAt_idx" ON "EmailDelivery"("sheetSyncRetryAt");

CREATE TABLE "SheetSyncJob" (
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

CREATE UNIQUE INDEX "SheetSyncJob_jobKey_key" ON "SheetSyncJob"("jobKey");
CREATE INDEX "SheetSyncJob_status_idx" ON "SheetSyncJob"("status");
CREATE INDEX "SheetSyncJob_nextRetryAt_idx" ON "SheetSyncJob"("nextRetryAt");
CREATE INDEX "SheetSyncJob_emailDeliveryId_idx" ON "SheetSyncJob"("emailDeliveryId");
