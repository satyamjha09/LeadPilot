ALTER TABLE "GoogleAuth"
ADD COLUMN IF NOT EXISTS "connectedEmail" TEXT,
ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);

UPDATE "GoogleAuth"
SET "senderAccountKey" = CASE
  WHEN LOWER(TRIM("email")) = 'demo.tallykonnect@gmail.com' THEN 'tallykonnect-google'
  WHEN LOWER(TRIM("email")) = 'info.anywheretally@gmail.com' THEN 'anywheretally-google'
  ELSE "senderAccountKey"
END
WHERE "senderAccountKey" IS NULL OR "senderAccountKey" = '';

UPDATE "GoogleAuth"
SET "connectedEmail" = LOWER(TRIM("email"))
WHERE ("connectedEmail" IS NULL OR "connectedEmail" = '')
  AND LOWER(TRIM("email")) IN ('demo.tallykonnect@gmail.com', 'info.anywheretally@gmail.com');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "GoogleAuth"
    WHERE "senderAccountKey" IS NULL
      OR "senderAccountKey" = ''
      OR "senderAccountKey" NOT IN ('tallykonnect-google', 'anywheretally-google')
  ) THEN
    RAISE EXCEPTION 'GoogleAuth contains unmapped senderAccountKey rows. Map them before applying this migration.';
  END IF;
END $$;

ALTER TABLE "GoogleAuth"
ALTER COLUMN "senderAccountKey" SET NOT NULL;

DROP INDEX IF EXISTS "GoogleAuth_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "GoogleAuth_senderAccountKey_key"
ON "GoogleAuth"("senderAccountKey");
