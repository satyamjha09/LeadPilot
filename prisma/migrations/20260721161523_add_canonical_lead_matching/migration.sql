-- Phase 4: deterministic canonical lead matching.

-- CreateEnum
CREATE TYPE "LeadIdentitySource" AS ENUM ('AUTO', 'MANUAL', 'MIGRATION');

-- CreateEnum
CREATE TYPE "LeadMatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'CONFLICT', 'SKIPPED');

-- CreateEnum
CREATE TYPE "LeadMatchRunStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "LeadMatchResultStatus" AS ENUM ('CREATED', 'MATCHED', 'UNCHANGED', 'CONFLICT', 'SKIPPED');

-- CreateEnum
CREATE TYPE "LeadMatchConflictStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "LeadMatchConflictType" AS ENUM ('MULTIPLE_LEADS', 'IDENTITY_OWNED_BY_ANOTHER_LEAD', 'LINKED_LEAD_CHANGED', 'NO_STRONG_IDENTITY', 'INVALID_IDENTITY');

-- AlterTable
ALTER TABLE "Lead"
ADD COLUMN "mergedIntoLeadId" TEXT,
ADD COLUMN "mergedAt" TIMESTAMP(3),
ADD COLUMN "lastMatchedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LeadIdentity"
ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'workspace',
ADD COLUMN "source" "LeadIdentitySource" NOT NULL DEFAULT 'AUTO',
ADD COLUMN "isVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "LeadIdentity"
SET "scopeKey" = 'workspace'
WHERE "scopeKey" IS NULL;

-- AlterTable
ALTER TABLE "SourceSnapshotRow"
ADD COLUMN "phone" TEXT,
ADD COLUMN "crmId" TEXT;

-- AlterTable
ALTER TABLE "SourceRow"
ADD COLUMN "phone" TEXT,
ADD COLUMN "crmId" TEXT,
ADD COLUMN "leadMatchStatus" "LeadMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
ADD COLUMN "leadMatchReason" TEXT,
ADD COLUMN "leadMatchedAt" TIMESTAMP(3),
ADD COLUMN "leadMatchStrategyVersion" TEXT;

-- CreateTable
CREATE TABLE "LeadIdentityObservation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "leadIdentityId" TEXT NOT NULL,
  "sourceRowId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadIdentityObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadMatchRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "dataSourceId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "strategyVersion" TEXT NOT NULL DEFAULT 'exact-v1',
  "status" "LeadMatchRunStatus" NOT NULL DEFAULT 'PROCESSING',
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "createdLeadCount" INTEGER NOT NULL DEFAULT 0,
  "matchedRowCount" INTEGER NOT NULL DEFAULT 0,
  "unchangedRowCount" INTEGER NOT NULL DEFAULT 0,
  "conflictCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "LeadMatchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadMatchResult" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sourceRowId" TEXT NOT NULL,
  "leadId" TEXT,
  "status" "LeadMatchResultStatus" NOT NULL,
  "reasonCode" TEXT,
  "identitiesJson" JSONB NOT NULL,
  "candidateLeadIds" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadMatchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadMatchConflict" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sourceRowId" TEXT NOT NULL,
  "type" "LeadMatchConflictType" NOT NULL,
  "status" "LeadMatchConflictStatus" NOT NULL DEFAULT 'OPEN',
  "identityClaims" JSONB NOT NULL,
  "candidateLeadIds" JSONB NOT NULL,
  "message" TEXT NOT NULL,
  "resolvedLeadId" TEXT,
  "resolutionNote" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadMatchConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadMergeHistory" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "sourceLeadId" TEXT NOT NULL,
  "targetLeadId" TEXT NOT NULL,
  "movedSourceRowCount" INTEGER NOT NULL,
  "movedIdentityCount" INTEGER NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadMergeHistory_pkey" PRIMARY KEY ("id")
);

-- DropIndex
DROP INDEX IF EXISTS "LeadIdentity_workspaceId_type_value_key";

-- CreateIndex
CREATE INDEX "Lead_workspaceId_mergedIntoLeadId_idx" ON "Lead"("workspaceId", "mergedIntoLeadId");

-- CreateIndex
CREATE INDEX "LeadIdentity_leadId_type_idx" ON "LeadIdentity"("leadId", "type");

-- CreateIndex
CREATE INDEX "LeadIdentity_workspaceId_type_idx" ON "LeadIdentity"("workspaceId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "LeadIdentity_workspaceId_type_scopeKey_value_key" ON "LeadIdentity"("workspaceId", "type", "scopeKey", "value");

-- CreateIndex
CREATE INDEX "SourceRow_workspaceId_leadMatchStatus_idx" ON "SourceRow"("workspaceId", "leadMatchStatus");

-- CreateIndex
CREATE INDEX "SourceRow_canonicalLeadId_isActive_idx" ON "SourceRow"("canonicalLeadId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LeadIdentityObservation_leadIdentityId_sourceRowId_key" ON "LeadIdentityObservation"("leadIdentityId", "sourceRowId");

-- CreateIndex
CREATE INDEX "LeadIdentityObservation_sourceRowId_idx" ON "LeadIdentityObservation"("sourceRowId");

-- CreateIndex
CREATE INDEX "LeadIdentityObservation_workspaceId_isActive_idx" ON "LeadIdentityObservation"("workspaceId", "isActive");

-- CreateIndex
CREATE INDEX "LeadMatchRun_workspaceId_startedAt_idx" ON "LeadMatchRun"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "LeadMatchRun_dataSourceId_startedAt_idx" ON "LeadMatchRun"("dataSourceId", "startedAt");

-- CreateIndex
CREATE INDEX "LeadMatchRun_snapshotId_idx" ON "LeadMatchRun"("snapshotId");

-- CreateIndex
CREATE INDEX "LeadMatchRun_status_idx" ON "LeadMatchRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LeadMatchRun_one_processing_per_source"
ON "LeadMatchRun" ("dataSourceId")
WHERE "status" = 'PROCESSING';

-- CreateIndex
CREATE UNIQUE INDEX "LeadMatchResult_runId_sourceRowId_key" ON "LeadMatchResult"("runId", "sourceRowId");

-- CreateIndex
CREATE INDEX "LeadMatchResult_sourceRowId_idx" ON "LeadMatchResult"("sourceRowId");

-- CreateIndex
CREATE INDEX "LeadMatchResult_leadId_idx" ON "LeadMatchResult"("leadId");

-- CreateIndex
CREATE INDEX "LeadMatchResult_status_idx" ON "LeadMatchResult"("status");

-- CreateIndex
CREATE INDEX "LeadMatchConflict_workspaceId_status_idx" ON "LeadMatchConflict"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "LeadMatchConflict_runId_idx" ON "LeadMatchConflict"("runId");

-- CreateIndex
CREATE INDEX "LeadMatchConflict_sourceRowId_idx" ON "LeadMatchConflict"("sourceRowId");

-- CreateIndex
CREATE INDEX "LeadMergeHistory_workspaceId_createdAt_idx" ON "LeadMergeHistory"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadMergeHistory_sourceLeadId_idx" ON "LeadMergeHistory"("sourceLeadId");

-- CreateIndex
CREATE INDEX "LeadMergeHistory_targetLeadId_idx" ON "LeadMergeHistory"("targetLeadId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_mergedIntoLeadId_fkey" FOREIGN KEY ("mergedIntoLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadIdentityObservation" ADD CONSTRAINT "LeadIdentityObservation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadIdentityObservation" ADD CONSTRAINT "LeadIdentityObservation_leadIdentityId_fkey" FOREIGN KEY ("leadIdentityId") REFERENCES "LeadIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadIdentityObservation" ADD CONSTRAINT "LeadIdentityObservation_sourceRowId_fkey" FOREIGN KEY ("sourceRowId") REFERENCES "SourceRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMatchRun" ADD CONSTRAINT "LeadMatchRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMatchRun" ADD CONSTRAINT "LeadMatchRun_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMatchRun" ADD CONSTRAINT "LeadMatchRun_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMatchResult" ADD CONSTRAINT "LeadMatchResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LeadMatchRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMatchResult" ADD CONSTRAINT "LeadMatchResult_sourceRowId_fkey" FOREIGN KEY ("sourceRowId") REFERENCES "SourceRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMatchResult" ADD CONSTRAINT "LeadMatchResult_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMatchConflict" ADD CONSTRAINT "LeadMatchConflict_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMatchConflict" ADD CONSTRAINT "LeadMatchConflict_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LeadMatchRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMatchConflict" ADD CONSTRAINT "LeadMatchConflict_sourceRowId_fkey" FOREIGN KEY ("sourceRowId") REFERENCES "SourceRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMatchConflict" ADD CONSTRAINT "LeadMatchConflict_resolvedLeadId_fkey" FOREIGN KEY ("resolvedLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMergeHistory" ADD CONSTRAINT "LeadMergeHistory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMergeHistory" ADD CONSTRAINT "LeadMergeHistory_sourceLeadId_fkey" FOREIGN KEY ("sourceLeadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMergeHistory" ADD CONSTRAINT "LeadMergeHistory_targetLeadId_fkey" FOREIGN KEY ("targetLeadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
