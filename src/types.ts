import { LeadStatusLabel } from '@/src/lib/leadStatus';
import type { EmailBrandKey } from '@/src/lib/emailBrand';
import type { SenderAccountKey } from '@/src/lib/senderAccount';

export interface ExcelRow {
  id: string;
  __originalColumns?: string[];
  __sourceType?: SourceType;
  __sourceRowNumber?: number;
  __sheetRowNumber?: number;
  __spreadsheetId?: string;
  __sheetName?: string;
  __emailBrand?: EmailBrandKey;
  __senderAccountKey?: SenderAccountKey;
  full_name?: string;
  email?: string;
  'Date of Demo'?: string | number;
  'Time of Demo'?: string | number;
  'Meeting Details'?: string;
  lead_status?: LeadStatusLabel | string;
  automation_id?: string;
  email_status?: string;
  email_sent_at?: string;
  gmail_message_id?: string;
  email_last_error?: string;
  email_retry_count?: number;
  __schedulerStatus?: 'Failed';
  __dbFinalState?: boolean;
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
  noResponse?: number;
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
  automationId?: string;
  emailBrand: EmailBrandKey;
  fullName: string;
  email: string;
  dateStr?: string;
  timeStr?: string;
  dateTimeStr: string;
  meetLink: string;
  reminderSent: boolean;
  scheduledTime: number;
  sentTime?: number;
  status: 'Pending' | 'Sent' | 'Failed';
  error?: string;
}

export interface NotificationCounts {
  manualReview: number;
  emailLogs: number;
}

export interface AuthStatus {
  brand?: EmailBrandKey;
  key?: SenderAccountKey;
  senderAccountKey?: SenderAccountKey;
  displayName?: string;
  expectedEmail?: string;
  email?: string;
  connectedEmail?: string;
  authenticated: boolean;
  configured: boolean;
  clientId?: string;
  redirectUri?: string;
  authUrl?: string;
  isUsingEnvToken: boolean;
  envTokenSuppressed?: boolean;
  requiresReconnect?: boolean;
  authError?: string;
}

export interface DashboardTrendPoint {
  date: string;
  count: number;
}

export type DashboardActivityTone = 'success' | 'failed' | 'progress';

export interface DashboardActivityEvent {
  id: string;
  type: 'lead-schedule' | 'email-delivery' | 'sheet-sync' | 'process-job';
  title: string;
  description: string;
  status: string;
  tone: DashboardActivityTone;
  occurredAt: string;
  meta?: string;
}

export interface DashboardHealthSummary {
  emailFailures: number;
  emailUnknown: number;
  emailRetryPending: number;
  sheetSyncFailed: number;
  sheetSyncPending: number;
  failedProcessJobs: number;
  activeProcessJobs: number;
  issueCount: number;
  warningCount: number;
  updatedAt: string;
}
