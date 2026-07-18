-- Isolate failed Google Sheet update retry jobs per sending brand.
DROP INDEX IF EXISTS "SheetSyncJob_jobKey_key";

CREATE UNIQUE INDEX IF NOT EXISTS "SheetSyncJob_emailBrand_jobKey_key"
  ON "SheetSyncJob"("emailBrand", "jobKey");

CREATE INDEX IF NOT EXISTS "SheetSyncJob_emailBrand_status_idx"
  ON "SheetSyncJob"("emailBrand", "status");

CREATE INDEX IF NOT EXISTS "SheetSyncJob_emailBrand_nextRetryAt_idx"
  ON "SheetSyncJob"("emailBrand", "nextRetryAt");
