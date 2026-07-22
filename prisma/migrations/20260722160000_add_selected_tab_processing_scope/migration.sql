-- Phase 12: durable selected-tab processing ownership.
-- All fields are nullable so historical jobs and retry records remain valid.

ALTER TABLE "DataSource"
ADD COLUMN "googleAccountKey" TEXT;

UPDATE "DataSource"
SET "googleAccountKey" = CASE
  WHEN "type" = 'GOOGLE_SHEETS' AND "workspaceId" IN (SELECT "id" FROM "Workspace" WHERE "key" = 'anywheretally')
    THEN 'anywheretally-google'
  WHEN "type" = 'GOOGLE_SHEETS'
    THEN 'tallykonnect-google'
  ELSE NULL
END
WHERE "googleAccountKey" IS NULL;

ALTER TABLE "SheetSyncJob"
ADD COLUMN "dataSourceId" TEXT,
ADD COLUMN "sourceTabId" TEXT,
ADD COLUMN "sourceRowId" TEXT;

ALTER TABLE "ProcessLeadJob"
ADD COLUMN "googleAccountKey" TEXT,
ADD COLUMN "dataSourceId" TEXT,
ADD COLUMN "sourceTabId" TEXT,
ADD COLUMN "sourceSnapshotId" TEXT,
ADD COLUMN "sourceRowIdsJson" TEXT;

UPDATE "ProcessLeadJob"
SET "googleAccountKey" = CASE
  WHEN COALESCE("workspaceKey", "emailBrand") = 'anywheretally'
    THEN 'anywheretally-google'
  ELSE 'tallykonnect-google'
END
WHERE "googleAccountKey" IS NULL;

CREATE INDEX "DataSource_googleAccountKey_idx" ON "DataSource"("googleAccountKey");

CREATE INDEX "SheetSyncJob_dataSourceId_idx" ON "SheetSyncJob"("dataSourceId");
CREATE INDEX "SheetSyncJob_sourceTabId_idx" ON "SheetSyncJob"("sourceTabId");
CREATE INDEX "SheetSyncJob_sourceRowId_idx" ON "SheetSyncJob"("sourceRowId");

CREATE INDEX "ProcessLeadJob_dataSourceId_idx" ON "ProcessLeadJob"("dataSourceId");
CREATE INDEX "ProcessLeadJob_sourceTabId_idx" ON "ProcessLeadJob"("sourceTabId");
CREATE INDEX "ProcessLeadJob_sourceSnapshotId_idx" ON "ProcessLeadJob"("sourceSnapshotId");
CREATE INDEX "ProcessLeadJob_emailBrand_sourceTabId_idx" ON "ProcessLeadJob"("emailBrand", "sourceTabId");
CREATE INDEX "ProcessLeadJob_workspaceKey_dataSourceId_idx" ON "ProcessLeadJob"("workspaceKey", "dataSourceId");
