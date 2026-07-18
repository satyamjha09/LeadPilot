-- DropForeignKey
ALTER TABLE "DemoHistory" DROP CONSTRAINT "DemoHistory_userId_fkey";

-- DropIndex
DROP INDEX "CustomerDemoState_userId_key";

-- DropIndex
DROP INDEX "LeadSchedule_automationId_dateOfDemo_timeOfDemo_key";

-- DropIndex
DROP INDEX "SheetLeadState_sheetRowKey_key";

-- CreateIndex
CREATE INDEX "CustomerDemoState_emailBrand_status_idx" ON "CustomerDemoState"("emailBrand", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDemoState_emailBrand_userId_key" ON "CustomerDemoState"("emailBrand", "userId");

-- CreateIndex
CREATE INDEX "DemoHistory_emailBrand_userId_idx" ON "DemoHistory"("emailBrand", "userId");

-- CreateIndex
CREATE INDEX "DemoHistory_emailBrand_email_idx" ON "DemoHistory"("emailBrand", "email");

-- CreateIndex
CREATE INDEX "DemoHistory_emailBrand_status_idx" ON "DemoHistory"("emailBrand", "status");

-- CreateIndex
CREATE INDEX "LeadSchedule_emailBrand_email_dateOfDemo_timeOfDemo_idx" ON "LeadSchedule"("emailBrand", "email", "dateOfDemo", "timeOfDemo");

-- CreateIndex
CREATE INDEX "LeadSchedule_emailBrand_automationId_idx" ON "LeadSchedule"("emailBrand", "automationId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSchedule_emailBrand_automationId_dateOfDemo_timeOfDemo_key" ON "LeadSchedule"("emailBrand", "automationId", "dateOfDemo", "timeOfDemo");

-- CreateIndex
CREATE INDEX "SheetLeadState_emailBrand_spreadsheetId_sheetName_sheetRowN_idx" ON "SheetLeadState"("emailBrand", "spreadsheetId", "sheetName", "sheetRowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SheetLeadState_emailBrand_sheetRowKey_key" ON "SheetLeadState"("emailBrand", "sheetRowKey");

-- AddForeignKey
ALTER TABLE "DemoHistory" ADD CONSTRAINT "DemoHistory_emailBrand_userId_fkey" FOREIGN KEY ("emailBrand", "userId") REFERENCES "CustomerDemoState"("emailBrand", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
