-- Store durable process-lead queue state and results in PostgreSQL.
CREATE TABLE "ProcessLeadJob" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "sourceType" TEXT NOT NULL,
    "spreadsheetId" TEXT,
    "sheetName" TEXT,
    "headersJson" TEXT,
    "inputRowsJson" TEXT NOT NULL,
    "resultRowsJson" TEXT,
    "summaryJson" TEXT,
    "progressJson" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessLeadJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProcessLeadJob_status_idx" ON "ProcessLeadJob"("status");
CREATE INDEX "ProcessLeadJob_createdAt_idx" ON "ProcessLeadJob"("createdAt");
