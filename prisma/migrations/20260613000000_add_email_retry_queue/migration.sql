ALTER TABLE "EmailDelivery"
ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "maxRetries" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "nextRetryAt" TIMESTAMP(3),
ADD COLUMN "subject" TEXT,
ADD COLUMN "textBody" TEXT,
ADD COLUMN "htmlBody" TEXT;

CREATE INDEX "EmailDelivery_nextRetryAt_idx" ON "EmailDelivery"("nextRetryAt");
