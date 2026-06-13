import fs from 'fs';
import path from 'path';
import { ScheduledReminder, ReminderConfig, ExcelRow } from '../src/types';
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
  EMAIL_TYPES,
  getAutomationId
} from './emailIdentity';
import { prisma } from './db';
import { LEAD_STATUS } from './leadStatus';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const MEETINGS_PATH = path.join(DATA_DIR, 'scheduled_meetings.json');
const CONFIG_PATH = path.join(DATA_DIR, 'reminder_config.json');

// Ensure database folder exists
const dataDir = path.dirname(MEETINGS_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export function getScheduledReminders(): ScheduledReminder[] {
  if (fs.existsSync(MEETINGS_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(MEETINGS_PATH, 'utf-8'));
    } catch (e) {
      console.error('Failed to read scheduled meetings database:', e);
      return [];
    }
  }
  return [];
}

export function saveScheduledReminders(reminders: ScheduledReminder[]) {
  try {
    fs.writeFileSync(MEETINGS_PATH, JSON.stringify(reminders, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save scheduled meetings database:', e);
  }
}

export function getReminderConfig(): ReminderConfig {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (e) {
      console.error('Failed to read reminder configuration:', e);
    }
  }
  // Reminders are opt-in so the scheduler does not send extra emails by default.
  return { offsetMinutes: 120, enabled: false };
}

export function saveReminderConfig(config: ReminderConfig) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save reminder configuration:', e);
  }
}

// Function to add a scheduled meeting from the excel processing
export function addScheduledReminder(row: ExcelRow, meetLink: string, eventStartTimeMs: number) {
  const reminders = getScheduledReminders();
  
  // Create or update record based on row email and date of demo
  const rowId = row.id;
  const fullName = row.full_name || 'Client';
  const email = row.email || '';
  const dateStr = String(row['Date of Demo'] || '');
  const timeStr = String(row['Time of Demo'] || '');
  const automationId = getAutomationId(row, {
    sourceType: row.__sourceType || 'excel',
    spreadsheetId: row.__spreadsheetId,
    sheetName: row.__sheetName
  });
  
  // Check if we already have it scheduled for this specific rowId
  const index = reminders.findIndex(r => r.rowId === rowId);
  
  const record: ScheduledReminder = {
    id: index >= 0 ? reminders[index].id : `rem-${rowId}-${Date.now()}`,
    rowId,
    automationId,
    fullName,
    email,
    dateStr,
    timeStr,
    dateTimeStr: `${dateStr} ${timeStr}`,
    meetLink,
    scheduledTime: eventStartTimeMs, // Epoch milliseconds of meeting
    reminderSent: index >= 0 ? reminders[index].reminderSent : false,
    status: index >= 0 ? reminders[index].status : 'Pending'
  };

  if (index >= 0) {
    // If details or time changed, we can reset the sent status
    if (reminders[index].scheduledTime !== eventStartTimeMs || reminders[index].meetLink !== meetLink) {
      record.reminderSent = false;
      record.status = 'Pending';
      delete record.sentTime;
      delete record.error;
    } else {
      record.reminderSent = reminders[index].reminderSent;
      record.status = reminders[index].status;
      record.sentTime = reminders[index].sentTime;
      record.error = reminders[index].error;
    }
    reminders[index] = record;
  } else {
    reminders.push(record);
  }
  
  saveScheduledReminders(reminders);
}

export function invalidateScheduledReminder(row: ExcelRow, reason = 'Reminder invalidated by reschedule') {
  const reminders = getScheduledReminders();
  const rowId = row.id;
  const automationId = (() => {
    try {
      return getAutomationId(row, {
        sourceType: row.__sourceType || 'excel',
        spreadsheetId: row.__spreadsheetId,
        sheetName: row.__sheetName
      });
    } catch {
      return '';
    }
  })();
  let modified = false;

  for (const reminder of reminders) {
    if (
      reminder.status === 'Pending' &&
      (reminder.rowId === rowId || (automationId && reminder.automationId === automationId))
    ) {
      reminder.status = 'Failed';
      reminder.error = reason;
      reminder.reminderSent = false;
      modified = true;
    }
  }

  if (modified) {
    saveScheduledReminders(reminders);
  }
}

// Check and send pending reminders
export async function checkAndSendReminders() {
  const config = getReminderConfig();
  if (!config.enabled) return;

  const reminders = getScheduledReminders();
  const now = Date.now();
  const offsetMs = config.offsetMinutes * 60 * 1000;
  
  let modified = false;

  for (const reminder of reminders) {
    // Only send reminders that haven't been sent, are currently 'Pending', and the meeting is in the future
    if (reminder.status === 'Pending' && !reminder.reminderSent) {
      const timeToMeeting = reminder.scheduledTime - now;
      
      // If the meeting is starting within the offset window (e.g., 2 hours) and has not occurred yet
      if (timeToMeeting <= offsetMs && timeToMeeting > 0) {
        const activeState = await prisma.customerDemoState.findUnique({
          where: { email: reminder.email.toLowerCase().trim() }
        });
        const activeHistory = activeState?.activeDemoSessionId
          ? await prisma.demoHistory.findUnique({ where: { sessionId: activeState.activeDemoSessionId } })
          : null;
        const stillActive =
          activeState?.status === LEAD_STATUS.DEMO_SCHEDULED &&
          activeHistory?.status === LEAD_STATUS.DEMO_SCHEDULED &&
          activeState.meetingLink === reminder.meetLink &&
          activeState.demoDate === reminder.dateStr &&
          activeState.demoTime === reminder.timeStr;

        if (!stillActive) {
          reminder.status = 'Failed';
          reminder.error = 'Reminder skipped because active demo no longer matches';
          modified = true;
          continue;
        }

        console.log(`Sending automated meeting reminder to ${reminder.email} for meeting in ${Math.round(timeToMeeting / 60000)} minutes`);
        let activeDeliveryId = '';
        try {
          const [dateStr = 'Scheduled Date', ...timeParts] = reminder.dateTimeStr.split(' ');
          const reminderDate = reminder.dateStr || dateStr || 'Scheduled Date';
          const reminderTime = reminder.timeStr || timeParts.join(' ') || 'Scheduled Time';
          const automationId = reminder.automationId || `reminder_${reminder.rowId}`;
          const eventKey = createEmailEventKey({
            automationId,
            recipient: reminder.email,
            emailType: EMAIL_TYPES.REMINDER,
            date: reminderDate,
            time: reminderTime,
            reminderWindow: `${config.offsetMinutes}_MINUTES`
          });
          const template = buildReminderEmail({
            fullName: reminder.fullName,
            date: reminderDate,
            time: reminderTime,
            meetLink: reminder.meetLink
          });
          const payloadHash = createEmailPayloadHash({
            recipient: reminder.email,
            subject: template.subject,
            text: template.text,
            html: template.html
          });
          const claim = await claimEmailDelivery({
            eventKey,
            automationId,
            emailType: EMAIL_TYPES.REMINDER,
            recipient: reminder.email,
            payloadHash,
            subject: template.subject,
            text: template.text,
            html: template.html
          });

          if (claim.claimed === false) {
            console.log('EMAIL_SKIPPED', {
              eventKey,
              automationId,
              recipient: reminder.email,
              emailType: EMAIL_TYPES.REMINDER,
              reason: claim.reason
            });
            if (claim.reason === 'ALREADY_SENT') {
              reminder.reminderSent = true;
              reminder.status = 'Sent';
              reminder.sentTime = Date.now();
              delete reminder.error;
              modified = true;
            }
            continue;
          }
          activeDeliveryId = claim.deliveryId;

          const sendResult = await sendGmailReminder(
            reminder.fullName,
            reminder.email,
            reminderDate,
            reminderTime,
            reminder.meetLink
          );

          await markEmailDeliverySent({
            deliveryId: claim.deliveryId,
            providerMessageId: sendResult.messageId
          });
          
          reminder.reminderSent = true;
          reminder.status = 'Sent';
          reminder.sentTime = Date.now();
          delete reminder.error;
          modified = true;
        } catch (err: any) {
          console.error(`Error sending reminder to ${reminder.email}:`, err);
          if (activeDeliveryId) {
            await markEmailDeliveryFailed({ deliveryId: activeDeliveryId, error: err });
          }
          reminder.status = 'Failed';
          reminder.error = err.message || 'Unknown sending error';
          modified = true;
        }
      } else if (timeToMeeting <= 0) {
        // Meeting is already in the past, or actively premium. Mark as past/failed to avoid spamming
        reminder.status = 'Failed';
        reminder.error = 'Meeting past before reminder window was processed';
        modified = true;
      }
    }
  }

  if (modified) {
    saveScheduledReminders(reminders);
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
    reminderTimer = setTimeout(runReminderScanner, 30000);
  }
}

export function initReminderJob() {
  if (reminderTimer) return;
  console.log('Initiating meeting reminder automated background scanner...');
  reminderTimer = setTimeout(runReminderScanner, 1000);
}

export function stopReminderJob() {
  if (reminderTimer) {
    clearTimeout(reminderTimer);
    reminderTimer = undefined;
  }
}
