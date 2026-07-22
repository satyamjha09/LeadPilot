import type {
  DataSourceConnectionStatus,
  DataSourceType,
  Prisma,
  SourceRowValidationStatus,
  SourceSnapshotStatus
} from '@prisma/client';

export type DataSourceCreateInput = {
  workspaceId: string;
  type: DataSourceType;
  displayName: string;
  externalFileId?: string | null;
  originalFileName?: string | null;
  storageKey?: string | null;
  mimeType?: string | null;
  checksum?: string | null;
  fileSize?: number | null;
  googleAccountKey?: string | null;
  connectionStatus?: DataSourceConnectionStatus;
  syncEnabled?: boolean;
};

export type DataSourceTabCreateInput = {
  dataSourceId: string;
  externalTabId: string;
  name: string;
  position?: number | null;
  headersJson: Prisma.InputJsonValue;
  headerHash?: string | null;
  rowCount?: number;
};

export type SourceSnapshotCreateInput = {
  dataSourceId: string;
  sourceTabId?: string | null;
  version: number;
  status?: SourceSnapshotStatus;
  checksum?: string | null;
  rawFileKey?: string | null;
};

export type SourceRowCreateInput = {
  workspaceId: string;
  dataSourceId: string;
  sourceTabId: string;
  externalRowId: string;
  rowHash: string;
  rawData: Prisma.InputJsonValue;
  normalizedData: Prisma.InputJsonValue;
  rowNumber?: number | null;
  automationId?: string | null;
  email?: string | null;
  fullName?: string | null;
  leadStatus?: string | null;
  demoDate?: string | null;
  demoTime?: string | null;
  meetingLink?: string | null;
  remarks?: string | null;
  validationStatus?: SourceRowValidationStatus;
  validationErrors?: Prisma.InputJsonValue;
  canonicalLeadId?: string | null;
};

export type SourceTabUpsertInput = {
  externalTabId: string;
  name: string;
  position: number;
  headersJson: Prisma.InputJsonValue;
  headerHash: string;
  isEnabled?: boolean;
};

export type SourceWithTabsInput = DataSourceCreateInput & {
  tabs: SourceTabUpsertInput[];
  preferredTabId?: string | null;
};

export type SourceDetailsUpdateInput = {
  displayName?: string;
  externalFileId?: string | null;
  originalFileName?: string | null;
  storageKey?: string | null;
  mimeType?: string | null;
  checksum?: string | null;
  fileSize?: number | null;
  googleAccountKey?: string | null;
  syncEnabled?: boolean;
  connectionStatus?: DataSourceConnectionStatus;
  archivedAt?: Date | null;
  lastValidatedAt?: Date | null;
  lastSyncedAt?: Date | null;
  lastSyncStatus?: string | null;
  lastError?: string | null;
};
