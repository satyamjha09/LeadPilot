CREATE TABLE "WorkflowControl" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "isResetting" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowControl_pkey" PRIMARY KEY ("id")
);

INSERT INTO "WorkflowControl" ("id", "generation", "isResetting", "updatedAt")
VALUES ('global', 1, false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "ProcessLeadJob" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "ProcessLeadJob_generation_idx" ON "ProcessLeadJob"("generation");
