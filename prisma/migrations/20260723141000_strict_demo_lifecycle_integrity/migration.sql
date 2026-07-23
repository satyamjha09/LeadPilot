-- Strict demo lifecycle integrity: session-scoped schedules and email deliveries.
-- This migration is intentionally non-destructive for existing rows.

ALTER TABLE "LeadSchedule"
  ADD COLUMN IF NOT EXISTS "demoSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceRowId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceTabId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceSnapshotId" TEXT;

ALTER TABLE "EmailDelivery"
  ADD COLUMN IF NOT EXISTS "demoSessionId" TEXT;

ALTER TABLE "EmailDelivery"
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

DROP INDEX IF EXISTS "LeadSchedule_emailBrand_automationId_dateOfDemo_timeOfDemo_key";

CREATE UNIQUE INDEX IF NOT EXISTS "LeadSchedule_emailBrand_demoSessionId_key"
  ON "LeadSchedule"("emailBrand", "demoSessionId");

CREATE INDEX IF NOT EXISTS "LeadSchedule_emailBrand_demoSessionId_idx"
  ON "LeadSchedule"("emailBrand", "demoSessionId");

CREATE INDEX IF NOT EXISTS "LeadSchedule_sourceRowId_idx"
  ON "LeadSchedule"("sourceRowId");

CREATE INDEX IF NOT EXISTS "LeadSchedule_sourceTabId_idx"
  ON "LeadSchedule"("sourceTabId");

CREATE INDEX IF NOT EXISTS "LeadSchedule_sourceSnapshotId_idx"
  ON "LeadSchedule"("sourceSnapshotId");

CREATE INDEX IF NOT EXISTS "EmailDelivery_emailBrand_demoSessionId_emailType_idx"
  ON "EmailDelivery"("emailBrand", "demoSessionId", "emailType");

CREATE INDEX IF NOT EXISTS "EmailDelivery_demoSessionId_idx"
  ON "EmailDelivery"("demoSessionId");
