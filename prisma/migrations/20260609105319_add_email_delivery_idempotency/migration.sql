-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventKey" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "emailType" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "providerMessageId" TEXT,
    "sentAt" DATETIME,
    "lockedAt" DATETIME,
    "lockedBy" TEXT,
    "lastError" TEXT,
    "sheetSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_eventKey_key" ON "EmailDelivery"("eventKey");

-- CreateIndex
CREATE INDEX "EmailDelivery_automationId_idx" ON "EmailDelivery"("automationId");

-- CreateIndex
CREATE INDEX "EmailDelivery_status_idx" ON "EmailDelivery"("status");

-- CreateIndex
CREATE INDEX "EmailDelivery_updatedAt_idx" ON "EmailDelivery"("updatedAt");
