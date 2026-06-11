-- CreateTable
CREATE TABLE "CustomerDemoState" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DemoHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DemoHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "CustomerDemoState" ("userId") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
