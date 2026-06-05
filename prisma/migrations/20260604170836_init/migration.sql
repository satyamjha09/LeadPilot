-- CreateTable
CREATE TABLE "LeadSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadSchedule_email_dateOfDemo_timeOfDemo_key" ON "LeadSchedule"("email", "dateOfDemo", "timeOfDemo");
