import { prisma } from './db';
import { cancelCalendarMeeting } from './googleAuth';
import { LEAD_STATUS } from './leadStatus';
import { createWorkflowBusyError } from './workflowActivity';
import type { EmailBrandKey } from '../src/lib/emailBrand';
import { parseSenderAccountKey, type SenderAccountKey } from '../src/lib/senderAccount';

const EMAIL_DELIVERY_STALE_LOCK_MS = Number(process.env.EMAIL_DELIVERY_STALE_LOCK_MS || 15 * 60 * 1000);
const SHEET_SYNC_STALE_LOCK_MS = Number(process.env.SHEET_SYNC_STALE_LOCK_MS || 10 * 60 * 1000);

export type CalendarResetCleanupResult = {
  cancelledCalendarEventCount: number;
  alreadyDeletedCalendarEventCount: number;
};

function freshLockCutoff(staleMs: number) {
  return new Date(Date.now() - staleMs);
}

export async function assertNoActiveResetClaims(emailBrand: EmailBrandKey) {
  const [runningProcessJobs, activeEmailDeliveries, activeSheetSyncJobs] = await Promise.all([
    prisma.processLeadJob.count({
      where: {
        emailBrand,
        status: 'RUNNING'
      }
    }),
    prisma.emailDelivery.count({
      where: {
        emailBrand,
        status: 'PROCESSING',
        lockedAt: {
          gt: freshLockCutoff(EMAIL_DELIVERY_STALE_LOCK_MS)
        }
      }
    }),
    prisma.sheetSyncJob.count({
      where: {
        emailBrand,
        status: 'PROCESSING',
        lockedAt: {
          gt: freshLockCutoff(SHEET_SYNC_STALE_LOCK_MS)
        }
      }
    })
  ]);

  if (runningProcessJobs > 0 || activeEmailDeliveries > 0 || activeSheetSyncJobs > 0) {
    throw createWorkflowBusyError();
  }
}

function calendarEventKey(event: { calendarEventId: string | null; senderAccountKey: string }) {
  return `${event.senderAccountKey}:${event.calendarEventId}`;
}

export async function cancelActiveCalendarEventsForReset(emailBrand: EmailBrandKey): Promise<CalendarResetCleanupResult> {
  const [activeStates, activeHistories] = await Promise.all([
    prisma.customerDemoState.findMany({
      where: {
        emailBrand,
        status: LEAD_STATUS.DEMO_SCHEDULED,
        calendarEventId: { not: null }
      },
      select: {
        calendarEventId: true,
        senderAccountKey: true
      }
    }),
    prisma.demoHistory.findMany({
      where: {
        emailBrand,
        status: LEAD_STATUS.DEMO_SCHEDULED,
        calendarEventId: { not: null }
      },
      select: {
        calendarEventId: true,
        senderAccountKey: true
      }
    })
  ]);

  const events = new Map<string, { calendarEventId: string; senderAccountKey: SenderAccountKey }>();
  for (const event of [...activeStates, ...activeHistories]) {
    if (!event.calendarEventId) continue;
    const senderAccountKey = parseSenderAccountKey(event.senderAccountKey);
    events.set(calendarEventKey({ calendarEventId: event.calendarEventId, senderAccountKey }), {
      calendarEventId: event.calendarEventId,
      senderAccountKey
    });
  }

  let cancelledCalendarEventCount = 0;
  let alreadyDeletedCalendarEventCount = 0;
  for (const event of events.values()) {
    const result = await cancelCalendarMeeting(event.calendarEventId, event.senderAccountKey);
    cancelledCalendarEventCount += 1;
    if (result.alreadyDeleted) alreadyDeletedCalendarEventCount += 1;
  }

  return {
    cancelledCalendarEventCount,
    alreadyDeletedCalendarEventCount
  };
}

export async function resetDemoTestData(emailBrand: EmailBrandKey) {
  return prisma.$transaction(async (tx) => {
    const sheetSyncJob = await tx.sheetSyncJob.deleteMany({ where: { emailBrand } });
    const emailDelivery = await tx.emailDelivery.deleteMany({ where: { emailBrand } });
    const emailLog = await tx.emailLog.deleteMany({ where: { emailBrand } });
    const sheetLeadState = await tx.sheetLeadState.deleteMany({ where: { emailBrand } });
    const demoHistory = await tx.demoHistory.deleteMany({ where: { emailBrand } });
    const customerDemoState = await tx.customerDemoState.deleteMany({ where: { emailBrand } });
    const leadSchedule = await tx.leadSchedule.deleteMany({ where: { emailBrand } });
    const processLeadJob = await tx.processLeadJob.deleteMany({ where: { emailBrand } });

    return {
      SheetSyncJob: sheetSyncJob.count,
      EmailDelivery: emailDelivery.count,
      EmailLog: emailLog.count,
      SheetLeadState: sheetLeadState.count,
      DemoHistory: demoHistory.count,
      CustomerDemoState: customerDemoState.count,
      LeadSchedule: leadSchedule.count,
      ProcessLeadJob: processLeadJob.count
    };
  });
}
