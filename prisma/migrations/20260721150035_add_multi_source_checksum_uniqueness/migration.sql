-- Add duplicate-upload protection for uploaded source files.
-- PostgreSQL allows multiple NULL values in a unique index, so Google Sheet
-- sources without a checksum are still governed by externalFileId identity.
CREATE UNIQUE INDEX "DataSource_workspaceId_type_checksum_key" ON "DataSource"("workspaceId", "type", "checksum");
