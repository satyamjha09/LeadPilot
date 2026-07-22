ALTER TABLE "SheetSyncJob"
ADD COLUMN IF NOT EXISTS "workspaceKey" TEXT,
ADD COLUMN IF NOT EXISTS "googleAccountKey" TEXT,
ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lockedBy" TEXT;

UPDATE "SheetSyncJob"
SET "workspaceKey" = COALESCE(NULLIF("workspaceKey", ''), NULLIF("emailBrand", ''), 'tallykonnect')
WHERE "workspaceKey" IS NULL OR "workspaceKey" = '';

UPDATE "SheetSyncJob"
SET "googleAccountKey" = CASE
  WHEN COALESCE(NULLIF("workspaceKey", ''), "emailBrand") = 'anywheretally' THEN 'anywheretally-google'
  ELSE 'tallykonnect-google'
END
WHERE "googleAccountKey" IS NULL OR "googleAccountKey" = '';

ALTER TABLE "SheetSyncJob"
ALTER COLUMN "workspaceKey" SET NOT NULL,
ALTER COLUMN "googleAccountKey" SET NOT NULL;

DROP INDEX IF EXISTS "SheetSyncJob_jobKey_key";
DROP INDEX IF EXISTS "SheetSyncJob_emailBrand_jobKey_key";

CREATE UNIQUE INDEX IF NOT EXISTS "SheetSyncJob_workspaceKey_emailBrand_jobKey_key"
ON "SheetSyncJob"("workspaceKey", "emailBrand", "jobKey");

CREATE INDEX IF NOT EXISTS "SheetSyncJob_workspaceKey_idx"
ON "SheetSyncJob"("workspaceKey");

CREATE INDEX IF NOT EXISTS "SheetSyncJob_workspaceKey_status_idx"
ON "SheetSyncJob"("workspaceKey", "status");

CREATE INDEX IF NOT EXISTS "SheetSyncJob_workspaceKey_nextRetryAt_idx"
ON "SheetSyncJob"("workspaceKey", "nextRetryAt");

CREATE INDEX IF NOT EXISTS "SheetSyncJob_emailBrand_status_idx"
ON "SheetSyncJob"("emailBrand", "status");

CREATE INDEX IF NOT EXISTS "SheetSyncJob_emailDeliveryId_idx"
ON "SheetSyncJob"("emailDeliveryId");
