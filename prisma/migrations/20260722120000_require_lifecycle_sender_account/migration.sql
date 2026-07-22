UPDATE "LeadSchedule"
SET "senderAccountKey" = CASE
  WHEN "emailBrand" = 'anywheretally' THEN 'anywheretally-google'
  ELSE 'tallykonnect-google'
END
WHERE "senderAccountKey" IS NULL OR "senderAccountKey" = '';

UPDATE "CustomerDemoState"
SET "senderAccountKey" = CASE
  WHEN "emailBrand" = 'anywheretally' THEN 'anywheretally-google'
  ELSE 'tallykonnect-google'
END
WHERE "senderAccountKey" IS NULL OR "senderAccountKey" = '';

UPDATE "DemoHistory"
SET "senderAccountKey" = CASE
  WHEN "emailBrand" = 'anywheretally' THEN 'anywheretally-google'
  ELSE 'tallykonnect-google'
END
WHERE "senderAccountKey" IS NULL OR "senderAccountKey" = '';

UPDATE "ProcessLeadJob"
SET "senderAccountKey" = CASE
  WHEN "emailBrand" = 'anywheretally' THEN 'anywheretally-google'
  ELSE 'tallykonnect-google'
END
WHERE "senderAccountKey" IS NULL OR "senderAccountKey" = '';

ALTER TABLE "LeadSchedule" ALTER COLUMN "senderAccountKey" SET NOT NULL;
ALTER TABLE "CustomerDemoState" ALTER COLUMN "senderAccountKey" SET NOT NULL;
ALTER TABLE "DemoHistory" ALTER COLUMN "senderAccountKey" SET NOT NULL;
ALTER TABLE "ProcessLeadJob" ALTER COLUMN "senderAccountKey" SET NOT NULL;
