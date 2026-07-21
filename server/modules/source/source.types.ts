import type {
  DataSourceConnectionStatus,
  DataSourceType,
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
  connectionStatus?: DataSourceConnectionStatus;
  syncEnabled?: boolean;
};

export type DataSourceTabCreateInput = {
  dataSourceId: string;
  externalTabId: string;
  name: string;
  position?: number | null;
  headersJson: any;
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
  rawData: any;
  normalizedData: any;
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
  validationErrors?: any;
  canonicalLeadId?: string | null;
};
