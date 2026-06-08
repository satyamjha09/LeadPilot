import { LeadStatusLabel } from '@/src/lib/leadStatus';

export interface ExcelRow {
  id: string;
  __originalColumns?: string[];
  __sourceType?: SourceType;
  __sourceRowNumber?: number;
  __sheetRowNumber?: number;
  __spreadsheetId?: string;
  __sheetName?: string;
  full_name?: string;
  email?: string;
  'Date of Demo'?: string | number;
  'Time of Demo'?: string | number;
  'Meeting Details'?: string;
  lead_status?: LeadStatusLabel | string;
  __schedulerStatus?: 'Failed';
  Remarks?: string;
  [key: string]: unknown;
}

export interface ScheduleSummary {
  totalRows: number;
  total?: number;
  scheduled: number;
  failed: number;
  skipped: number;
  demoScheduled?: number;
  reschedule?: number;
  demoDone?: number;
  statusOnly?: number;
  timeConflicts?: number;
}

export type SourceType = 'excel' | 'google-sheet';

export type GoogleSheetMeta = {
  spreadsheetId: string;
  gid?: string;
  sheetName: string;
  headers: string[];
};

export type SheetSource =
  | { type: 'excel' }
  | ({ type: 'google-sheet' } & GoogleSheetMeta);

export interface ReminderConfig {
  offsetMinutes: number;
  enabled: boolean;
}

export interface ScheduledReminder {
  id: string;
  rowId: string;
  fullName: string;
  email: string;
  dateTimeStr: string;
  meetLink: string;
  reminderSent: boolean;
  scheduledTime: number;
  sentTime?: number;
  status: 'Pending' | 'Sent' | 'Failed';
  error?: string;
}

export interface AuthStatus {
  authenticated: boolean;
  configured: boolean;
  clientId?: string;
  redirectUri?: string;
  authUrl?: string;
  isUsingEnvToken: boolean;
  envTokenSuppressed?: boolean;
}
