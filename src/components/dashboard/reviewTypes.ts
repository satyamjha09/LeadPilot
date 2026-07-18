import type { EmailBrandKey } from '@/src/lib/emailBrand';

export type EmailHistoryLog = {
  id: string;
  source?: string;
  emailBrand?: EmailBrandKey;
  type: string;
  status: string;
  recipient?: string | null;
  messageId?: string | null;
  error?: string | null;
  sentAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  attemptCount?: number;
};

export type SheetSyncJob = {
  id: string;
  emailBrand?: EmailBrandKey;
  status: string;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: string | null;
  lastError?: string | null;
  updatedAt?: string;
  createdAt: string;
};

export function isSentStatus(status: string) {
  return status.toLowerCase() === 'sent';
}

export function isNeedsReviewStatus(status: string) {
  return status.toUpperCase() === 'UNKNOWN';
}

export function isFailedEmailStatus(status: string) {
  return ['FAILED', 'RETRY_PENDING', 'UNKNOWN'].includes(status.toUpperCase());
}

export function isSheetSyncIssue(status: string) {
  return status === 'FAILED' || status === 'PENDING';
}

export function formatLogType(type: string) {
  if (type === 'DEMO_SCHEDULED') return 'Meeting invite';
  if (type === 'DEMO_RESCHEDULED') return 'Reschedule email';
  if (type === 'DEMO_DONE') return 'Thank-you email';
  if (type === 'DEMO_DONE_THANK_YOU') return 'Thank-you email';
  if (type === 'NO_RESPONSE') return 'Not Attended email';
  return type.replace(/_/g, ' ').toLowerCase();
}

export function formatStatus(status: string) {
  if (isNeedsReviewStatus(status)) return 'needs review';
  return status.replace(/_/g, ' ').toLowerCase();
}

export function formatSource(source: string) {
  if (source === 'EmailDelivery') return 'Delivery log';
  if (source === 'EmailLog') return 'Legacy email log';
  return source;
}

export function formatSheetSyncStatus(status: string) {
  if (status === 'PENDING') return 'Sheet Sync Pending';
  if (status === 'FAILED') return 'Sheet Sync Failed';
  if (status === 'SYNCED') return 'Sheet Synced';
  return status.replace(/_/g, ' ').toLowerCase();
}

export function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}
