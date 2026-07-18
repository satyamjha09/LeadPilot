-- DropIndex
DROP INDEX "EmailDelivery_eventKey_key";

-- DropIndex
DROP INDEX "EmailLog_email_rowKey_type_key";

-- CreateIndex
CREATE INDEX "EmailDelivery_emailBrand_automationId_idx" ON "EmailDelivery"("emailBrand", "automationId");

-- CreateIndex
CREATE INDEX "EmailDelivery_emailBrand_status_idx" ON "EmailDelivery"("emailBrand", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_emailBrand_eventKey_key" ON "EmailDelivery"("emailBrand", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_emailBrand_email_rowKey_type_key" ON "EmailLog"("emailBrand", "email", "rowKey", "type");
