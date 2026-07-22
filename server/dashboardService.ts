import { prisma } from './db';
import { parseEmailBrand, type EmailBrandKey } from '../src/lib/emailBrand';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const TREND_MAX_DAYS = 31;
export const DASHBOARD_ACTIVITY_MAX_LIMIT = 50;
const TREND_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'Asia/Kolkata'
});

export function clampTrendDays(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(TREND_MAX_DAYS, Math.max(1, Math.floor(parsed)));
}

export function clampActivityLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(DASHBOARD_ACTIVITY_MAX_LIMIT, Math.max(1, Math.floor(parsed)));
}

export function parseDashboardEmailBrandScope(value: unknown, legacyBrandAlias?: unknown) {
  return parseEmailBrand(value ?? legacyBrandAlias);
}

export function istDateKey(date: Date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function startOfTodayInIstUtc(now = new Date()) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  ) - IST_OFFSET_MS);
}

function activityTone(status: string) {
  const normalized = status.trim().toUpperCase();
  if (['FAILED', 'ERROR', 'UNKNOWN'].includes(normalized) || normalized.includes('FAILED')) return 'failed';
  if (['SENT', 'COMPLETED', 'SUCCEEDED', 'SUCCESS', 'DEMO SCHEDULED', 'DEMO DONE'].includes(normalized)) {
    return 'success';
  }
  return 'progress';
}

function readableEmailType(type: string) {
  return type
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export async function getScheduledLeadTrend(emailBrand: EmailBrandKey, days: number, now = new Date()) {
  const todayStart = startOfTodayInIstUtc(now);
  const rangeStart = new Date(todayStart.getTime() - (days - 1) * DAY_MS);
  const rangeEnd = new Date(todayStart.getTime() + DAY_MS);
  const buckets = Array.from({ length: days }, (_, index) => {
    const dayStart = new Date(rangeStart.getTime() + index * DAY_MS);
    return {
      key: istDateKey(dayStart),
      date: TREND_DATE_FORMATTER.format(dayStart),
      count: 0
    };
  });
  const bucketByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  // A scheduled lead is a LeadSchedule that successfully owns a Calendar event and Meet link.
  // This keeps later Demo Done/Not Attended outcomes in the original scheduled-day count while excluding failures and status-only updates.
  const schedules = await prisma.leadSchedule.findMany({
    where: {
      emailBrand,
      createdAt: {
        gte: rangeStart,
        lt: rangeEnd
      },
      status: { not: 'Failed' },
      AND: [
        { meetingLink: { not: null } },
        { meetingLink: { not: '' } },
        { calendarEventId: { not: null } },
        { calendarEventId: { not: '' } }
      ]
    },
    select: {
      createdAt: true
    }
  });

  schedules.forEach((schedule) => {
    const bucket = bucketByKey.get(istDateKey(schedule.createdAt));
    if (bucket) bucket.count += 1;
  });

  return buckets.map(({ date, count }) => ({ date, count }));
}

export async function getDashboardActivity(emailBrand: EmailBrandKey, limit: number) {
  const queryLimit = Math.max(limit, 10);
  const [schedules, deliveries, sheetJobs, processJobs] = await Promise.all([
    prisma.leadSchedule.findMany({
      where: { emailBrand },
      orderBy: { updatedAt: 'desc' },
      take: queryLimit,
      select: {
        id: true,
        emailBrand: true,
        senderAccountKey: true,
        fullName: true,
        email: true,
        status: true,
        remarks: true,
        dateOfDemo: true,
        timeOfDemo: true,
        updatedAt: true
      }
    }),
    prisma.emailDelivery.findMany({
      where: { emailBrand },
      orderBy: { updatedAt: 'desc' },
      take: queryLimit,
      select: {
        id: true,
        emailBrand: true,
        senderAccountKey: true,
        emailType: true,
        recipient: true,
        status: true,
        subject: true,
        lastError: true,
        sentAt: true,
        updatedAt: true
      }
    }),
    prisma.sheetSyncJob.findMany({
      where: { emailBrand },
      orderBy: { updatedAt: 'desc' },
      take: queryLimit,
      select: {
        id: true,
        emailBrand: true,
        workspaceKey: true,
        googleAccountKey: true,
        status: true,
        sheetName: true,
        rowNumber: true,
        lastError: true,
        updatedAt: true
      }
    }),
    prisma.processLeadJob.findMany({
      where: { emailBrand },
      orderBy: { updatedAt: 'desc' },
      take: queryLimit,
      select: {
        id: true,
        emailBrand: true,
        workspaceKey: true,
        senderAccountKey: true,
        status: true,
        sourceType: true,
        error: true,
        updatedAt: true
      }
    })
  ]);

  return [
    ...schedules.map((schedule) => ({
      id: `lead-schedule:${schedule.id}`,
      type: 'lead-schedule' as const,
      title: `${schedule.status || 'Lead updated'} - ${schedule.fullName || schedule.email}`,
      description: schedule.remarks || `${schedule.dateOfDemo || 'No date'} ${schedule.timeOfDemo || ''}`.trim(),
      status: schedule.status || 'Updated',
      tone: activityTone(schedule.status || ''),
      occurredAt: schedule.updatedAt.toISOString(),
      meta: schedule.email,
      emailBrand: schedule.emailBrand,
      senderAccountKey: schedule.senderAccountKey
    })),
    ...deliveries.map((delivery) => {
      const label = readableEmailType(delivery.emailType || 'Email');
      return {
        id: `email-delivery:${delivery.id}`,
        type: 'email-delivery' as const,
        title: `${label} email ${delivery.status.toLowerCase()}`,
        description: delivery.lastError || delivery.subject || `Recipient: ${delivery.recipient}`,
        status: delivery.status,
        tone: activityTone(delivery.status),
        occurredAt: (delivery.sentAt || delivery.updatedAt).toISOString(),
        meta: delivery.recipient,
        emailBrand: delivery.emailBrand,
        senderAccountKey: delivery.senderAccountKey
      };
    }),
    ...sheetJobs.map((job) => ({
      id: `sheet-sync:${job.id}`,
      type: 'sheet-sync' as const,
      title: `Sheet row ${job.rowNumber} ${job.status.toLowerCase()}`,
      description: job.lastError || `${job.sheetName} row update`,
      status: job.status,
      tone: activityTone(job.status),
      occurredAt: job.updatedAt.toISOString(),
      meta: job.sheetName,
      emailBrand: job.emailBrand,
      workspaceKey: job.workspaceKey,
      googleAccountKey: job.googleAccountKey
    })),
    ...processJobs.map((job) => ({
      id: `process-job:${job.id}`,
      type: 'process-job' as const,
      title: `Lead processing job ${job.status.toLowerCase()}`,
      description: job.error || `${job.sourceType === 'google-sheet' ? 'Google Sheet' : 'Excel'} workflow`,
      status: job.status,
      tone: activityTone(job.status),
      occurredAt: job.updatedAt.toISOString(),
      meta: job.id,
      emailBrand: job.emailBrand,
      workspaceKey: job.workspaceKey,
      senderAccountKey: job.senderAccountKey
    }))
  ]
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, limit);
}

export async function getDashboardHealth(emailBrand: EmailBrandKey) {
  const staleProcessingCutoff = new Date(Date.now() - 15 * 60 * 1000);
  const [
    emailFailures,
    emailUnknown,
    emailRetryPending,
    emailProcessingStale,
    sheetSyncFailed,
    sheetSyncPending,
    sheetSyncProcessingStale,
    failedProcessJobs,
    activeProcessJobs
  ] = await Promise.all([
    prisma.emailDelivery.count({ where: { emailBrand, status: 'FAILED' } }),
    prisma.emailDelivery.count({ where: { emailBrand, status: 'UNKNOWN' } }),
    prisma.emailDelivery.count({ where: { emailBrand, status: 'RETRY_PENDING' } }),
    prisma.emailDelivery.count({
      where: { emailBrand, status: 'PROCESSING', updatedAt: { lt: staleProcessingCutoff } }
    }),
    prisma.sheetSyncJob.count({ where: { emailBrand, status: 'FAILED' } }),
    prisma.sheetSyncJob.count({ where: { emailBrand, status: 'PENDING' } }),
    prisma.sheetSyncJob.count({
      where: { emailBrand, status: 'PROCESSING', updatedAt: { lt: staleProcessingCutoff } }
    }),
    prisma.processLeadJob.count({ where: { emailBrand, status: 'FAILED' } }),
    prisma.processLeadJob.count({ where: { emailBrand, status: { in: ['QUEUED', 'RUNNING'] } } })
  ]);

  const issueCount =
    emailFailures +
    emailUnknown +
    emailRetryPending +
    emailProcessingStale +
    sheetSyncFailed +
    sheetSyncPending +
    sheetSyncProcessingStale +
    failedProcessJobs;

  return {
    emailFailures,
    emailUnknown,
    emailRetryPending,
    emailProcessingStale,
    sheetSyncFailed,
    sheetSyncPending,
    sheetSyncProcessingStale,
    failedProcessJobs,
    activeProcessJobs,
    issueCount,
    warningCount: activeProcessJobs,
    updatedAt: new Date().toISOString()
  };
}
