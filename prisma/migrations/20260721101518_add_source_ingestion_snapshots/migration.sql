-- CreateEnum
CREATE TYPE "SourceRowIdentityType" AS ENUM ('AUTOMATION_ID', 'ROW_NUMBER');

-- AlterEnum
ALTER TYPE "SourceSnapshotStatus" ADD VALUE 'PARTIAL';

-- AlterTable
ALTER TABLE "SourceRow" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "firstSeenVersion" INTEGER,
ADD COLUMN     "identityType" "SourceRowIdentityType" NOT NULL DEFAULT 'ROW_NUMBER',
ADD COLUMN     "lastSeenVersion" INTEGER;

-- AlterTable
ALTER TABLE "SourceSnapshot" ADD COLUMN     "trigger" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "unchangedCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SourceSnapshotTab" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "sourceTabId" TEXT NOT NULL,
    "status" "SourceSnapshotStatus" NOT NULL DEFAULT 'PROCESSING',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "addedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "removedCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "headerHash" TEXT,
    "contentHash" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SourceSnapshotTab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSnapshotRow" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "sourceTabId" TEXT NOT NULL,
    "externalRowId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "identityType" "SourceRowIdentityType" NOT NULL,
    "rowHash" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB NOT NULL,
    "automationId" TEXT,
    "email" TEXT,
    "fullName" TEXT,
    "leadStatus" TEXT,
    "demoDate" TEXT,
    "demoTime" TEXT,
    "meetingLink" TEXT,
    "remarks" TEXT,
    "validationStatus" "SourceRowValidationStatus" NOT NULL DEFAULT 'VALID',
    "validationErrors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceSnapshotRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceSnapshotTab_snapshotId_idx" ON "SourceSnapshotTab"("snapshotId");

-- CreateIndex
CREATE INDEX "SourceSnapshotTab_sourceTabId_idx" ON "SourceSnapshotTab"("sourceTabId");

-- CreateIndex
CREATE INDEX "SourceSnapshotTab_status_idx" ON "SourceSnapshotTab"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SourceSnapshotTab_snapshotId_sourceTabId_key" ON "SourceSnapshotTab"("snapshotId", "sourceTabId");

-- CreateIndex
CREATE INDEX "SourceSnapshotRow_snapshotId_sourceTabId_idx" ON "SourceSnapshotRow"("snapshotId", "sourceTabId");

-- CreateIndex
CREATE INDEX "SourceSnapshotRow_sourceTabId_externalRowId_idx" ON "SourceSnapshotRow"("sourceTabId", "externalRowId");

-- CreateIndex
CREATE INDEX "SourceSnapshotRow_validationStatus_idx" ON "SourceSnapshotRow"("validationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "SourceSnapshotRow_snapshotId_sourceTabId_externalRowId_key" ON "SourceSnapshotRow"("snapshotId", "sourceTabId", "externalRowId");

-- Prevent simultaneous ingestion for the same source.
-- Prisma cannot express this PostgreSQL partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "SourceSnapshot_one_processing_per_source"
ON "SourceSnapshot" ("dataSourceId")
WHERE "status" = 'PROCESSING';

-- AddForeignKey
ALTER TABLE "SourceSnapshotTab" ADD CONSTRAINT "SourceSnapshotTab_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSnapshotTab" ADD CONSTRAINT "SourceSnapshotTab_sourceTabId_fkey" FOREIGN KEY ("sourceTabId") REFERENCES "DataSourceTab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSnapshotRow" ADD CONSTRAINT "SourceSnapshotRow_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSnapshotRow" ADD CONSTRAINT "SourceSnapshotRow_sourceTabId_fkey" FOREIGN KEY ("sourceTabId") REFERENCES "DataSourceTab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
