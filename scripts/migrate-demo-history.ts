import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db';
import { LEAD_STATUS, normalizeLeadStatus } from '../server/leadStatus';
import { coerceStoredEmailBrand } from '../src/lib/emailBrand';
import { defaultSenderAccountForBrand, parseSenderAccountKey } from '../src/lib/senderAccount';

const DEFAULT_TIMEZONE = process.env.GOOGLE_CALENDAR_TIME_ZONE || 'Asia/Kolkata';

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

async function main() {
  const schedules = await prisma.leadSchedule.findMany();
  let migrated = 0;
  let convertedNoShow = 0;

  for (const schedule of schedules) {
    const normalizedStatus = normalizeLeadStatus(schedule.status) || schedule.status;

    if (/^no show$/i.test(schedule.status)) {
      await prisma.leadSchedule.update({
        where: { id: schedule.id },
        data: { status: LEAD_STATUS.NO_RESPONSE }
      });
      convertedNoShow++;
      continue;
    }

    if (
      normalizedStatus !== LEAD_STATUS.DEMO_SCHEDULED ||
      !schedule.meetingLink ||
      !schedule.calendarEventId
    ) {
      continue;
    }

    const userId = normalizeEmail(schedule.email);
    if (!userId) continue;

    const displayDate = schedule.dateOfDemo || '';
    const displayTime = schedule.timeOfDemo || '';
    const emailBrand = coerceStoredEmailBrand(schedule.emailBrand);
    const senderAccountKey = schedule.senderAccountKey
      ? parseSenderAccountKey(schedule.senderAccountKey)
      : defaultSenderAccountForBrand(emailBrand);
    const existingState = await prisma.customerDemoState.findUnique({
      where: {
        emailBrand_userId: {
          emailBrand,
          userId
        }
      }
    });
    const sessionId = existingState?.activeDemoSessionId || `demo_${randomUUID()}`;
    const scheduledAt = schedule.createdAt.toISOString();

    await prisma.customerDemoState.upsert({
      where: {
        emailBrand_userId: {
          emailBrand,
          userId
        }
      },
      create: {
        emailBrand,
        senderAccountKey,
        userId,
        fullName: schedule.fullName,
        email: userId,
        status: LEAD_STATUS.DEMO_SCHEDULED,
        activeDemoSessionId: sessionId,
        meetingLink: schedule.meetingLink,
        calendarEventId: schedule.calendarEventId,
        demoDate: displayDate,
        demoTime: displayTime,
        timezone: DEFAULT_TIMEZONE,
        sourceType: schedule.sourceType,
        sourceId: schedule.sourceId,
        sheetRowNumber: schedule.sheetRowNumber
      },
      update: {
        senderAccountKey,
        fullName: schedule.fullName,
        email: userId,
        status: LEAD_STATUS.DEMO_SCHEDULED,
        activeDemoSessionId: sessionId,
        meetingLink: schedule.meetingLink,
        calendarEventId: schedule.calendarEventId,
        demoDate: displayDate,
        demoTime: displayTime,
        timezone: DEFAULT_TIMEZONE,
        sourceType: schedule.sourceType,
        sourceId: schedule.sourceId,
        sheetRowNumber: schedule.sheetRowNumber
      }
    });

    await prisma.demoHistory.upsert({
      where: { sessionId },
      create: {
        emailBrand,
        senderAccountKey,
        sessionId,
        userId,
        fullName: schedule.fullName,
        email: userId,
        status: LEAD_STATUS.DEMO_SCHEDULED,
        scheduledStartUtc: schedule.createdAt.toISOString(),
        scheduledEndUtc: schedule.createdAt.toISOString(),
        displayDate,
        displayTime,
        timezone: DEFAULT_TIMEZONE,
        meetingLink: schedule.meetingLink,
        calendarEventId: schedule.calendarEventId,
        scheduledEmailSentAt: schedule.gmailMessageId ? schedule.updatedAt.toISOString() : null,
        scheduledAt
      },
      update: {
        senderAccountKey,
        fullName: schedule.fullName,
        email: userId,
        status: LEAD_STATUS.DEMO_SCHEDULED,
        displayDate,
        displayTime,
        timezone: DEFAULT_TIMEZONE,
        meetingLink: schedule.meetingLink,
        calendarEventId: schedule.calendarEventId
      }
    });

    migrated++;
  }

  console.log(`Demo history migration complete. Migrated active demos: ${migrated}. Converted legacy no-response statuses: ${convertedNoShow}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
