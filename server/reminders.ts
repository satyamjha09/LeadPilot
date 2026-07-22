import fs from 'fs';
import path from 'path';
import { ReminderConfig, ScheduledReminder, ExcelRow } from '../src/types';
import { sendGmailReminder } from './googleAuth';
import { buildReminderEmail } from './emailTemplates';
import {
  claimEmailDelivery,
  markEmailDeliveryFailed,
  markEmailDeliverySent
} from './emailDelivery';
import {
  createEmailEventKey,
  createEmailPayloadHash,
  EMAIL_TYPES
} from './emailIdentity';
import { prisma } from './db';
import { LEAD_STATUS } from './leadStatus';
import { coerceStoredEmailBrand } from '../src/lib/emailBrand';
import { parseSenderAccountKey } from '../src/lib/senderAccount';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'reminder_config.json');
const REMINDER_SCAN_INTERVAL_MS = Number(process.env.REMINDER_SCAN_INTERVAL_MS || 30_000);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export async function getScheduledReminders(): Promise<ScheduledReminder[]> {
  const histories = await prisma.demoHistory.findMany({
    where: { status: LEAD_STATUS.DEMO_SCHEDULED },
    orderBy: { scheduledStartUtc: 'asc' },
    take: 200
  });

  return histories.map((history) => ({
    id: history.sessionId,
    rowId: history.sessionId,
    automationId: history.userId,
    emailBrand: coerceStoredEmailBrand(history.emailBrand),
    fullName: history.fullName || 'Client',
    email: history.email,
    dateStr: history.displayDate,
    timeStr: history.displayTime,
    dateTimeStr: `${history.displayDate} ${history.displayTime}`,
    meetLink: history.meetingLink,
    reminderSent: !!history.reminder1HourSentAt || !!history.reminder24HourSentAt,
    scheduledTime: Date.parse(history.scheduledStartUtc),
    sentTime: history.reminder1HourSentAt
      ? Date.parse(history.reminder1HourSentAt)
      : history.reminder24HourSentAt
        ? Date.parse(history.reminder24HourSentAt)
        : undefined,
    status: history.reminder1HourSentAt || history.reminder24HourSentAt ? 'Sent' : 'Pending'
  }));
}

export function getReminderConfig(): ReminderConfig {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (e) {
      console.error('Failed to read reminder configuration:', e);
    }
  }
  return { offsetMinutes: 120, enabled: false };
}

export function saveReminderConfig(config: ReminderConfig) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save reminder configuration:', e);
  }
}

// Reminder queue is DB-driven through DemoHistory. Scheduling already writes DemoHistory.
export function addScheduledReminder(_row: ExcelRow, _meetLink: string, _eventStartTimeMs: number) {}

// Reschedule updates the active DemoHistory record, so no local queue invalidation is needed.
export function invalidateScheduledReminder(_row: ExcelRow, _reason = 'Reminder invalidated by reschedule') {}

function reminderSentField(offsetMinutes: number) {
  return offsetMinutes >= 24 * 60 ? 'reminder24HourSentAt' : 'reminder1HourSentAt';
}

async function findDueReminderHistories(config: ReminderConfig) {
  const now = Date.now();
  const dueFrom = new Date(now).toISOString();
  const dueUntil = new Date(now + config.offsetMinutes * 60 * 1000).toISOString();

  const sentField = reminderSentField(config.offsetMinutes);
  return prisma.demoHistory.findMany({
    where: {
      status: LEAD_STATUS.DEMO_SCHEDULED,
      scheduledStartUtc: {
        gt: dueFrom,
        lte: dueUntil
      },
      [sentField]: null
    } as any,
    orderBy: { scheduledStartUtc: 'asc' },
    take: 50
  });
}

export async function checkAndSendReminders() {
  const config = getReminderConfig();
  if (!config.enabled) return;

  const histories = await findDueReminderHistories(config);
  const sentField = reminderSentField(config.offsetMinutes);

  for (const history of histories) {
    const emailBrand = coerceStoredEmailBrand(history.emailBrand);
    const senderAccountKey = parseSenderAccountKey(history.senderAccountKey);
    const activeState = await prisma.customerDemoState.findUnique({
      where: {
        emailBrand_userId: {
          emailBrand,
          userId: history.userId
        }
      }
    });
    const stillActive =
      activeState?.status === LEAD_STATUS.DEMO_SCHEDULED &&
      activeState.activeDemoSessionId === history.sessionId &&
      activeState.senderAccountKey === senderAccountKey &&
      activeState.meetingLink === history.meetingLink &&
      activeState.demoDate === history.displayDate &&
      activeState.demoTime === history.displayTime;

    if (!stillActive) continue;

    console.log('REMINDER_SEND_DUE', {
      sessionId: history.sessionId,
      userId: history.userId,
      recipient: history.email,
      offsetMinutes: config.offsetMinutes
    });

    let activeDeliveryId = '';
    try {
      const eventKey = createEmailEventKey({
        automationId: history.userId,
        recipient: history.email,
        emailType: EMAIL_TYPES.REMINDER,
        date: history.displayDate,
        time: history.displayTime,
        reminderWindow: `${config.offsetMinutes}_MINUTES`
      });
      const template = buildReminderEmail({
        fullName: history.fullName || 'Client',
        date: history.displayDate,
        time: history.displayTime,
        meetLink: history.meetingLink,
        brand: emailBrand
      });
      const payloadHash = createEmailPayloadHash({
        recipient: history.email,
        subject: template.subject,
        text: template.text,
        html: template.html
      });
      const claim = await claimEmailDelivery({
        eventKey,
        automationId: history.userId,
        emailType: EMAIL_TYPES.REMINDER,
        recipient: history.email,
        emailBrand,
        senderAccountKey,
        payloadHash,
        subject: template.subject,
        text: template.text,
        html: template.html
      });

      if (claim.claimed === false) {
        if (claim.reason === 'ALREADY_SENT') {
          await prisma.demoHistory.update({
            where: { sessionId: history.sessionId },
            data: { [sentField]: new Date().toISOString() } as any
          });
        }
        continue;
      }

      activeDeliveryId = claim.deliveryId;
      const sendResult = await sendGmailReminder(
        history.fullName || 'Client',
        history.email,
        history.displayDate,
        history.displayTime,
        history.meetingLink,
        senderAccountKey,
        emailBrand
      );

      await markEmailDeliverySent({
        deliveryId: claim.deliveryId,
        providerMessageId: sendResult.messageId
      });

      await prisma.demoHistory.update({
        where: { sessionId: history.sessionId },
        data: { [sentField]: new Date().toISOString() } as any
      });
    } catch (err) {
      console.error('REMINDER_SEND_FAILED', {
        sessionId: history.sessionId,
        error: err instanceof Error ? err.message : String(err)
      });
      if (activeDeliveryId) {
        await markEmailDeliveryFailed({ deliveryId: activeDeliveryId, error: err });
      }
    }
  }
}

let reminderScannerRunning = false;
let reminderTimer: NodeJS.Timeout | undefined;

async function runReminderScanner() {
  if (reminderScannerRunning) {
    console.log('REMINDER_SCAN_SKIPPED', {
      reason: 'Previous scan is still running'
    });
    return;
  }

  reminderScannerRunning = true;

  try {
    await checkAndSendReminders();
  } catch (error) {
    console.error('REMINDER_SCAN_FAILED', {
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    reminderScannerRunning = false;
    reminderTimer = setTimeout(runReminderScanner, REMINDER_SCAN_INTERVAL_MS);
    reminderTimer.unref?.();
  }
}

export function initReminderJob() {
  if (reminderTimer) return;
  console.log('Initiating DB-driven meeting reminder scanner...');
  reminderTimer = setTimeout(runReminderScanner, 1000);
  reminderTimer.unref?.();
}

export function stopReminderJob() {
  if (reminderTimer) {
    clearTimeout(reminderTimer);
    reminderTimer = undefined;
  }
}
