import fs from 'fs';
import path from 'path';
import { ScheduledReminder, ReminderConfig, ExcelRow } from '../src/types';
import { sendGmailReminder } from './googleAuth';

const MEETINGS_PATH = path.join(process.cwd(), 'data', 'scheduled_meetings.json');
const CONFIG_PATH = path.join(process.cwd(), 'data', 'reminder_config.json');

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
  
  // Check if we already have it scheduled for this specific rowId
  const index = reminders.findIndex(r => r.rowId === rowId);
  
  const record: ScheduledReminder = {
    id: index >= 0 ? reminders[index].id : `rem-${rowId}-${Date.now()}`,
    rowId,
    fullName,
    email,
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
        console.log(`Sending automated meeting reminder to ${reminder.email} for meeting in ${Math.round(timeToMeeting / 60000)} minutes`);
        try {
          const [dateStr = 'Scheduled Date', ...timeParts] = reminder.dateTimeStr.split(' ');
          const timeStr = timeParts.join(' ') || 'Scheduled Time';
          await sendGmailReminder(
            reminder.fullName,
            reminder.email,
            dateStr || 'Scheduled Date',
            timeStr || 'Scheduled Time',
            reminder.meetLink
          );
          
          reminder.reminderSent = true;
          reminder.status = 'Sent';
          reminder.sentTime = Date.now();
          delete reminder.error;
          modified = true;
        } catch (err: any) {
          console.error(`Error sending reminder to ${reminder.email}:`, err);
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

// Background poller scheduler definition
let pollerInterval: NodeJS.Timeout | null = null;

export function initReminderJob() {
  if (pollerInterval) {
    clearInterval(pollerInterval);
  }
  
  console.log('Initiating meeting reminder automated background scanner...');
  // Check every 30 seconds for immediate responsiveness
  pollerInterval = setInterval(async () => {
    try {
      await checkAndSendReminders();
    } catch (e) {
      console.error('Error during automatic reminder dispatch cycle:', e);
    }
  }, 30000);
}
