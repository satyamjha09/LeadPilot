-- Phase 4.5: decouple Google sender accounts from template branding.

-- CreateTable
CREATE TABLE "GoogleOAuthState" (
  "id" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "senderAccountKey" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleOAuthState_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "GoogleAuth"
ADD COLUMN "senderAccountKey" TEXT;

-- Backfill known Google token owners without touching token values.
UPDATE "GoogleAuth"
SET "senderAccountKey" = CASE
  WHEN LOWER("email") = 'info.anywheretally@gmail.com' THEN 'anywheretally-google'
  WHEN LOWER("email") = 'demo.tallykonnect@gmail.com' THEN 'tallykonnect-google'
  ELSE "senderAccountKey"
END
WHERE "senderAccountKey" IS NULL;

-- AlterTable
ALTER TABLE "EmailDelivery"
ADD COLUMN "senderAccountKey" TEXT;

UPDATE "EmailDelivery"
SET "senderAccountKey" = CASE
  WHEN "emailBrand" = 'anywheretally' THEN 'anywheretally-google'
  ELSE 'tallykonnect-google'
END
WHERE "senderAccountKey" IS NULL;

ALTER TABLE "EmailDelivery"
ALTER COLUMN "senderAccountKey" SET NOT NULL;

-- AlterTable
ALTER TABLE "LeadSchedule"
ADD COLUMN "senderAccountKey" TEXT;

UPDATE "LeadSchedule"
SET "senderAccountKey" = CASE
  WHEN "emailBrand" = 'anywheretally' THEN 'anywheretally-google'
  ELSE 'tallykonnect-google'
END
WHERE "senderAccountKey" IS NULL;

-- AlterTable
ALTER TABLE "CustomerDemoState"
ADD COLUMN "senderAccountKey" TEXT;

UPDATE "CustomerDemoState"
SET "senderAccountKey" = CASE
  WHEN "emailBrand" = 'anywheretally' THEN 'anywheretally-google'
  ELSE 'tallykonnect-google'
END
WHERE "senderAccountKey" IS NULL;

-- AlterTable
ALTER TABLE "DemoHistory"
ADD COLUMN "senderAccountKey" TEXT;

UPDATE "DemoHistory"
SET "senderAccountKey" = CASE
  WHEN "emailBrand" = 'anywheretally' THEN 'anywheretally-google'
  ELSE 'tallykonnect-google'
END
WHERE "senderAccountKey" IS NULL;

-- AlterTable
ALTER TABLE "ProcessLeadJob"
ADD COLUMN "workspaceKey" TEXT,
ADD COLUMN "emailBrandKey" TEXT,
ADD COLUMN "senderAccountKey" TEXT;

-- Backfill existing queued/history jobs so old records remain readable.
UPDATE "ProcessLeadJob"
SET
  "workspaceKey" = COALESCE("workspaceKey", "emailBrand"),
  "emailBrandKey" = COALESCE("emailBrandKey", "emailBrand"),
  "senderAccountKey" = COALESCE(
    "senderAccountKey",
    CASE
      WHEN "emailBrand" = 'anywheretally' THEN 'anywheretally-google'
      ELSE 'tallykonnect-google'
    END
  );

-- CreateIndex
CREATE UNIQUE INDEX "GoogleOAuthState_stateHash_key" ON "GoogleOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "GoogleOAuthState_senderAccountKey_idx" ON "GoogleOAuthState"("senderAccountKey");

-- CreateIndex
CREATE INDEX "GoogleOAuthState_expiresAt_idx" ON "GoogleOAuthState"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleAuth_senderAccountKey_key" ON "GoogleAuth"("senderAccountKey");

-- CreateIndex
CREATE INDEX "EmailDelivery_senderAccountKey_idx" ON "EmailDelivery"("senderAccountKey");
