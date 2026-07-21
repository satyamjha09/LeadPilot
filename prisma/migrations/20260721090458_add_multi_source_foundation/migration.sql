-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DataSourceType" AS ENUM ('GOOGLE_SHEETS', 'EXCEL', 'CSV');

-- CreateEnum
CREATE TYPE "DataSourceConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SourceSnapshotStatus" AS ENUM ('CREATED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SourceRowValidationStatus" AS ENUM ('VALID', 'WARNING', 'INVALID');

-- CreateEnum
CREATE TYPE "LeadIdentityType" AS ENUM ('EMAIL', 'PHONE', 'AUTOMATION_ID', 'CRM_ID');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "DataSourceType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "externalFileId" TEXT,
    "originalFileName" TEXT,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "checksum" TEXT,
    "fileSize" INTEGER,
    "connectionStatus" "DataSourceConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastValidatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastError" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSourceTab" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "externalTabId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "headerHash" TEXT,
    "headersJson" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSourceTab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSnapshot" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "sourceTabId" TEXT,
    "version" INTEGER NOT NULL,
    "status" "SourceSnapshotStatus" NOT NULL DEFAULT 'CREATED',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "addedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "removedCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "rawFileKey" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SourceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "primaryEmail" TEXT,
    "normalizedEmail" TEXT,
    "fullName" TEXT,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadIdentity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "LeadIdentityType" NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "sourceTabId" TEXT NOT NULL,
    "externalRowId" TEXT NOT NULL,
    "rowNumber" INTEGER,
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
    "canonicalLeadId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_key_key" ON "Workspace"("key");

-- CreateIndex
CREATE INDEX "DataSource_workspaceId_idx" ON "DataSource"("workspaceId");

-- CreateIndex
CREATE INDEX "DataSource_workspaceId_type_idx" ON "DataSource"("workspaceId", "type");

-- CreateIndex
CREATE INDEX "DataSource_workspaceId_archivedAt_idx" ON "DataSource"("workspaceId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_workspaceId_type_externalFileId_key" ON "DataSource"("workspaceId", "type", "externalFileId");

-- CreateIndex
CREATE INDEX "DataSourceTab_dataSourceId_idx" ON "DataSourceTab"("dataSourceId");

-- CreateIndex
CREATE INDEX "DataSourceTab_dataSourceId_isEnabled_idx" ON "DataSourceTab"("dataSourceId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "DataSourceTab_dataSourceId_externalTabId_key" ON "DataSourceTab"("dataSourceId", "externalTabId");

-- CreateIndex
CREATE INDEX "SourceSnapshot_dataSourceId_createdAt_idx" ON "SourceSnapshot"("dataSourceId", "createdAt");

-- CreateIndex
CREATE INDEX "SourceSnapshot_sourceTabId_idx" ON "SourceSnapshot"("sourceTabId");

-- CreateIndex
CREATE INDEX "SourceSnapshot_status_idx" ON "SourceSnapshot"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SourceSnapshot_dataSourceId_version_key" ON "SourceSnapshot"("dataSourceId", "version");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_idx" ON "Lead"("workspaceId");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_status_idx" ON "Lead"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Lead_normalizedEmail_idx" ON "Lead"("normalizedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_workspaceId_normalizedEmail_key" ON "Lead"("workspaceId", "normalizedEmail");

-- CreateIndex
CREATE INDEX "LeadIdentity_leadId_idx" ON "LeadIdentity"("leadId");

-- CreateIndex
CREATE INDEX "LeadIdentity_workspaceId_idx" ON "LeadIdentity"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadIdentity_workspaceId_type_value_key" ON "LeadIdentity"("workspaceId", "type", "value");

-- CreateIndex
CREATE INDEX "SourceRow_workspaceId_idx" ON "SourceRow"("workspaceId");

-- CreateIndex
CREATE INDEX "SourceRow_dataSourceId_idx" ON "SourceRow"("dataSourceId");

-- CreateIndex
CREATE INDEX "SourceRow_sourceTabId_rowNumber_idx" ON "SourceRow"("sourceTabId", "rowNumber");

-- CreateIndex
CREATE INDEX "SourceRow_canonicalLeadId_idx" ON "SourceRow"("canonicalLeadId");

-- CreateIndex
CREATE INDEX "SourceRow_email_idx" ON "SourceRow"("email");

-- CreateIndex
CREATE INDEX "SourceRow_automationId_idx" ON "SourceRow"("automationId");

-- CreateIndex
CREATE INDEX "SourceRow_validationStatus_idx" ON "SourceRow"("validationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "SourceRow_sourceTabId_externalRowId_key" ON "SourceRow"("sourceTabId", "externalRowId");

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSourceTab" ADD CONSTRAINT "DataSourceTab_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSnapshot" ADD CONSTRAINT "SourceSnapshot_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSnapshot" ADD CONSTRAINT "SourceSnapshot_sourceTabId_fkey" FOREIGN KEY ("sourceTabId") REFERENCES "DataSourceTab"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadIdentity" ADD CONSTRAINT "LeadIdentity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadIdentity" ADD CONSTRAINT "LeadIdentity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRow" ADD CONSTRAINT "SourceRow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRow" ADD CONSTRAINT "SourceRow_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRow" ADD CONSTRAINT "SourceRow_sourceTabId_fkey" FOREIGN KEY ("sourceTabId") REFERENCES "DataSourceTab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRow" ADD CONSTRAINT "SourceRow_canonicalLeadId_fkey" FOREIGN KEY ("canonicalLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
