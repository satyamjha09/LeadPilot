ALTER TABLE "LeadSchedule"
ADD COLUMN IF NOT EXISTS "automationId" TEXT;

UPDATE "LeadSchedule"
SET "automationId" = CONCAT('sheet_', "sourceId", '_row_', "sheetRowNumber")
WHERE "automationId" IS NULL
  AND "sourceType" = 'google-sheet'
  AND "sourceId" IS NOT NULL
  AND "sheetRowNumber" IS NOT NULL;

UPDATE "LeadSchedule"
SET "automationId" = CONCAT('email_', MD5(LOWER("email")))
WHERE "automationId" IS NULL;

DELETE FROM "LeadSchedule" a
USING "LeadSchedule" b
WHERE a.ctid < b.ctid
  AND COALESCE(a."automationId", '') = COALESCE(b."automationId", '')
  AND a."dateOfDemo" = b."dateOfDemo"
  AND a."timeOfDemo" = b."timeOfDemo";

DROP INDEX IF EXISTS "LeadSchedule_email_dateOfDemo_timeOfDemo_key";
CREATE UNIQUE INDEX IF NOT EXISTS "LeadSchedule_automationId_dateOfDemo_timeOfDemo_key"
ON "LeadSchedule"("automationId", "dateOfDemo", "timeOfDemo");
CREATE INDEX IF NOT EXISTS "LeadSchedule_email_dateOfDemo_timeOfDemo_idx"
ON "LeadSchedule"("email", "dateOfDemo", "timeOfDemo");
CREATE INDEX IF NOT EXISTS "LeadSchedule_automationId_idx"
ON "LeadSchedule"("automationId");
