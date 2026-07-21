import type {
  DataSource,
  DataSourceTab,
  SourceRowIdentityType,
  SourceRowValidationStatus
} from '@prisma/client';
import type { Prisma } from '@prisma/client';

export type ReadSourceRow = {
  rowNumber: number;
  values: unknown[];
};

export type ReadSourceTabResult = {
  sourceTabId: string;
  externalTabId: string;
  name: string;
  headers: string[];
  headerHash: string;
  rows: ReadSourceRow[];
  error?: string;
};

export type SourceValidationError = {
  code: string;
  field?: string;
  severity: 'WARNING' | 'ERROR';
  message: string;
};

export type NormalizedSourceFields = {
  fullName: string;
  email: string;
  phone: string;
  crmId: string;
  leadStatus: string;
  demoDate: string;
  demoTime: string;
  meetingLink: string;
  remarks: string;
  automationId: string;
};

export type NormalizedReadRow = {
  sourceTabId: string;
  externalTabId: string;
  rowNumber: number;
  rawData: Prisma.InputJsonValue;
  normalizedData: Prisma.InputJsonValue;
  normalizedFields: NormalizedSourceFields;
  validationErrors: SourceValidationError[];
  validationStatus: SourceRowValidationStatus;
  externalRowId: string;
  identityType: SourceRowIdentityType;
  rowHash: string;
};

export type SourceWithTabs = DataSource & {
  tabs: DataSourceTab[];
};

export type IngestionSummary = {
  rowCount: number;
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  removedCount: number;
  invalidCount: number;
};
