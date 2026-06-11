-- CreateTable
CREATE TABLE "LeadSchedule" (
    "id" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT NOT NULL,
    "dateOfDemo" TEXT NOT NULL,
    "timeOfDemo" TEXT NOT NULL,
    "meetingLink" TEXT,
    "calendarEventId" TEXT,
    "gmailMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "remarks" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sheetRowNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "messageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "emailType" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "sheetSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetLeadState" (
    "id" TEXT NOT NULL,
    "sheetRowKey" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "sheetRowNumber" INTEGER NOT NULL,
    "email" TEXT,
    "lastLeadStatus" TEXT,
    "lastMeetingDate" TEXT,
    "lastMeetingTime" TEXT,
    "lastMeetingLink" TEXT,
    "lastAction" TEXT,
    "lastActionStatus" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheetLeadState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerDemoState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "activeDemoSessionId" TEXT,
    "meetingLink" TEXT,
    "calendarEventId" TEXT,
    "demoStartUtc" TEXT,
    "demoEndUtc" TEXT,
    "demoDate" TEXT,
    "demoTime" TEXT,
    "timezone" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sheetRowNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDemoState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoHistory" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheduledStartUtc" TEXT NOT NULL,
    "scheduledEndUtc" TEXT NOT NULL,
    "displayDate" TEXT NOT NULL,
    "displayTime" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "meetingLink" TEXT NOT NULL,
    "calendarEventId" TEXT NOT NULL,
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledEmailSentAt" TEXT,
    "reminder24HourSentAt" TEXT,
    "reminder1HourSentAt" TEXT,
    "demoDoneEmailSentAt" TEXT,
    "noResponseEmailSentAt" TEXT,
    "cancellationEmailSentAt" TEXT,
    "scheduledAt" TEXT NOT NULL,
    "completedAt" TEXT,
    "noResponseAt" TEXT,
    "cancelledAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadSchedule_email_dateOfDemo_timeOfDemo_key" ON "LeadSchedule"("email", "dateOfDemo", "timeOfDemo");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_email_rowKey_type_key" ON "EmailLog"("email", "rowKey", "type");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_eventKey_key" ON "EmailDelivery"("eventKey");

-- CreateIndex
CREATE INDEX "EmailDelivery_automationId_idx" ON "EmailDelivery"("automationId");

-- CreateIndex
CREATE INDEX "EmailDelivery_status_idx" ON "EmailDelivery"("status");

-- CreateIndex
CREATE INDEX "EmailDelivery_updatedAt_idx" ON "EmailDelivery"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SheetLeadState_sheetRowKey_key" ON "SheetLeadState"("sheetRowKey");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDemoState_userId_key" ON "CustomerDemoState"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDemoState_email_key" ON "CustomerDemoState"("email");

-- CreateIndex
CREATE INDEX "CustomerDemoState_status_idx" ON "CustomerDemoState"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DemoHistory_sessionId_key" ON "DemoHistory"("sessionId");

-- CreateIndex
CREATE INDEX "DemoHistory_userId_idx" ON "DemoHistory"("userId");

-- CreateIndex
CREATE INDEX "DemoHistory_email_idx" ON "DemoHistory"("email");

-- CreateIndex
CREATE INDEX "DemoHistory_status_idx" ON "DemoHistory"("status");

-- AddForeignKey
ALTER TABLE "DemoHistory" ADD CONSTRAINT "DemoHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "CustomerDemoState"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
