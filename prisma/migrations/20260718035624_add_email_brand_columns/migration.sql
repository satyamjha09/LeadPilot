/*
  Warnings:

  - Made the column `emailBrand` on table `ProcessLeadJob` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "CustomerDemoState" ADD COLUMN     "emailBrand" TEXT NOT NULL DEFAULT 'tallykonnect';

-- AlterTable
ALTER TABLE "DemoHistory" ADD COLUMN     "emailBrand" TEXT NOT NULL DEFAULT 'tallykonnect';

-- AlterTable
ALTER TABLE "EmailDelivery" ADD COLUMN     "emailBrand" TEXT NOT NULL DEFAULT 'tallykonnect';

-- AlterTable
ALTER TABLE "EmailLog" ADD COLUMN     "emailBrand" TEXT NOT NULL DEFAULT 'tallykonnect';

-- AlterTable
ALTER TABLE "LeadSchedule" ADD COLUMN     "emailBrand" TEXT NOT NULL DEFAULT 'tallykonnect';

-- Backfill nullable ProcessLeadJob brand values before making the column required.
UPDATE "ProcessLeadJob" SET "emailBrand" = 'tallykonnect' WHERE "emailBrand" IS NULL;

-- AlterTable
ALTER TABLE "ProcessLeadJob" ALTER COLUMN "emailBrand" SET NOT NULL,
ALTER COLUMN "emailBrand" SET DEFAULT 'tallykonnect';

-- AlterTable
ALTER TABLE "SheetLeadState" ADD COLUMN     "emailBrand" TEXT NOT NULL DEFAULT 'tallykonnect';

-- AlterTable
ALTER TABLE "SheetSyncJob" ADD COLUMN     "emailBrand" TEXT NOT NULL DEFAULT 'tallykonnect';

-- CreateIndex
CREATE INDEX "CustomerDemoState_emailBrand_idx" ON "CustomerDemoState"("emailBrand");

-- CreateIndex
CREATE INDEX "DemoHistory_emailBrand_idx" ON "DemoHistory"("emailBrand");

-- CreateIndex
CREATE INDEX "EmailDelivery_emailBrand_idx" ON "EmailDelivery"("emailBrand");

-- CreateIndex
CREATE INDEX "EmailLog_emailBrand_idx" ON "EmailLog"("emailBrand");

-- CreateIndex
CREATE INDEX "LeadSchedule_emailBrand_idx" ON "LeadSchedule"("emailBrand");

-- CreateIndex
CREATE INDEX "ProcessLeadJob_emailBrand_idx" ON "ProcessLeadJob"("emailBrand");

-- CreateIndex
CREATE INDEX "SheetLeadState_emailBrand_idx" ON "SheetLeadState"("emailBrand");

-- CreateIndex
CREATE INDEX "SheetSyncJob_emailBrand_idx" ON "SheetSyncJob"("emailBrand");
