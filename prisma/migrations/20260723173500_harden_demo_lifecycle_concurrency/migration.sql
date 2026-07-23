-- Harden strict demo lifecycle integrity.
-- This migration is conservative: legacy email-keyed states are adopted only when
-- one brand/email maps to exactly one automation_id and no target state exists.

DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT "leadId"
    FROM "LeadIdentity"
    WHERE "type" = 'AUTOMATION_ID'
      AND "scopeKey" = 'workspace'
    GROUP BY "leadId"
    HAVING COUNT(*) > 1
  ) duplicate_leads;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Preflight failed: % canonical lead(s) already have multiple permanent automation_id identities. Run the lifecycle audit/backfill report and resolve these records before applying this migration.',
      duplicate_count;
  END IF;
END $$;

WITH unambiguous_email_automation AS (
  SELECT
    "emailBrand",
    LOWER("email") AS "email",
    MIN("automationId") AS "automationId"
  FROM "LeadSchedule"
  WHERE "automationId" IS NOT NULL
    AND "automationId" <> ''
    AND "email" IS NOT NULL
    AND "email" <> ''
  GROUP BY "emailBrand", LOWER("email")
  HAVING COUNT(DISTINCT "automationId") = 1
),
adoptable_state AS (
  SELECT
    c."id",
    c."emailBrand",
    c."userId" AS "legacyUserId",
    u."automationId"
  FROM "CustomerDemoState" c
  JOIN unambiguous_email_automation u
    ON u."emailBrand" = c."emailBrand"
   AND u."email" = LOWER(c."email")
  WHERE c."userId" LIKE '%@%'
    AND LOWER(c."userId") = LOWER(c."email")
    AND NOT EXISTS (
      SELECT 1
      FROM "CustomerDemoState" existing
      WHERE existing."emailBrand" = c."emailBrand"
        AND existing."userId" = u."automationId"
    )
)
UPDATE "CustomerDemoState" c
SET "userId" = a."automationId"
FROM adoptable_state a
WHERE c."id" = a."id";

WITH unambiguous_email_automation AS (
  SELECT
    "emailBrand",
    LOWER("email") AS "email",
    MIN("automationId") AS "automationId"
  FROM "LeadSchedule"
  WHERE "automationId" IS NOT NULL
    AND "automationId" <> ''
    AND "email" IS NOT NULL
    AND "email" <> ''
  GROUP BY "emailBrand", LOWER("email")
  HAVING COUNT(DISTINCT "automationId") = 1
)
UPDATE "LeadSchedule" s
SET "automationId" = u."automationId"
FROM unambiguous_email_automation u
WHERE s."emailBrand" = u."emailBrand"
  AND LOWER(s."email") = u."email"
  AND (s."automationId" IS NULL OR s."automationId" = '' OR s."automationId" LIKE '%@%');

CREATE UNIQUE INDEX IF NOT EXISTS "LeadIdentity_one_automation_id_per_lead_key"
  ON "LeadIdentity"("leadId")
  WHERE "type" = 'AUTOMATION_ID'
    AND "scopeKey" = 'workspace';
