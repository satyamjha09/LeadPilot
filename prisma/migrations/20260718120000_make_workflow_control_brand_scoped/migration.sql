ALTER TABLE "WorkflowControl" ALTER COLUMN "id" DROP DEFAULT;

INSERT INTO "WorkflowControl" ("id", "generation", "isResetting", "updatedAt")
SELECT 'tallykonnect', "generation", false, CURRENT_TIMESTAMP
FROM "WorkflowControl"
WHERE "id" = 'global'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "WorkflowControl" ("id", "generation", "isResetting", "updatedAt")
SELECT 'anywheretally', "generation", false, CURRENT_TIMESTAMP
FROM "WorkflowControl"
WHERE "id" = 'global'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "WorkflowControl" ("id", "generation", "isResetting", "updatedAt")
VALUES
  ('tallykonnect', 1, false, CURRENT_TIMESTAMP),
  ('anywheretally', 1, false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

DELETE FROM "WorkflowControl" WHERE "id" = 'global';
