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

-- Backfill existing schedules to session identity only when the mapping is unambiguous.
WITH candidate_matches AS (
  SELECT
    s."id" AS "scheduleId",
    h."sessionId"
  FROM "LeadSchedule" s
  JOIN "DemoHistory" h
    ON h."emailBrand" = s."emailBrand"
   AND (
      (s."calendarEventId" IS NOT NULL AND s."calendarEventId" <> '' AND s."calendarEventId" = h."calendarEventId")
      OR (
        s."automationId" IS NOT NULL AND s."automationId" <> ''
        AND s."automationId" = h."userId"
        AND s."dateOfDemo" = h."displayDate"
        AND s."timeOfDemo" = h."displayTime"
      )
      OR (
        s."email" IS NOT NULL AND s."email" <> ''
        AND LOWER(s."email") = LOWER(h."email")
        AND s."dateOfDemo" = h."displayDate"
        AND s."timeOfDemo" = h."displayTime"
      )
    )
  WHERE s."demoSessionId" IS NULL
),
schedule_counts AS (
  SELECT "scheduleId", COUNT(DISTINCT "sessionId") AS "sessionCount"
  FROM candidate_matches
  GROUP BY "scheduleId"
),
session_counts AS (
  SELECT "sessionId", COUNT(DISTINCT "scheduleId") AS "scheduleCount"
  FROM candidate_matches
  GROUP BY "sessionId"
),
unambiguous AS (
  SELECT cm."scheduleId", cm."sessionId"
  FROM candidate_matches cm
  JOIN schedule_counts sc ON sc."scheduleId" = cm."scheduleId"
  JOIN session_counts hc ON hc."sessionId" = cm."sessionId"
  WHERE sc."sessionCount" = 1
    AND hc."scheduleCount" = 1
    AND NOT EXISTS (
      SELECT 1
      FROM "LeadSchedule" existing
      WHERE existing."emailBrand" = (
        SELECT s."emailBrand" FROM "LeadSchedule" s WHERE s."id" = cm."scheduleId"
      )
        AND existing."demoSessionId" = cm."sessionId"
    )
)
UPDATE "LeadSchedule" s
SET "demoSessionId" = u."sessionId"
FROM unambiguous u
WHERE s."id" = u."scheduleId";

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
