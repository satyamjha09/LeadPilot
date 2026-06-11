CREATE TABLE "SheetLeadState" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "SheetLeadState_sheetRowKey_key" ON "SheetLeadState"("sheetRowKey");
