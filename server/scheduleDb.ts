import { ExcelRow } from '../src/types';
import { randomUUID } from 'node:crypto';
import { prisma } from './db';
import { parseExcelDateTime } from './googleAuth';
import { LEAD_STATUS, normalizeLeadStatus } from './leadStatus';
import { normalizeDisplayDate, normalizeIsoDate } from '../src/lib/dateFormat';
import { coerceStoredEmailBrand, type EmailBrandKey } from '../src/lib/emailBrand';

const DEFAULT_TIMEZONE = process.env.GOOGLE_CALENDAR_TIME_ZONE || 'Asia/Kolkata';
const DEMO_EXPIRED_STATUS = 'Expired';
const ACTIVE_DEMO_BLOCKING_WINDOW_MS = Number(process.env.ACTIVE_DEMO_BLOCKING_WINDOW_MS || 60 * 60 * 1000);
const ACTIVE_DEMO_AUTO_EXPIRE_MS = Number(process.env.ACTIVE_DEMO_AUTO_EXPIRE_MS || 24 * 60 * 60 * 1000);

export function normalizeLeadEmail(email: unknown) {
  return String(email || '').trim().toLowerCase();
}

export function normalizeLeadDate(dateValue: unknown) {
  return normalizeDisplayDate(dateValue);
}

export function normalizeLeadTime(timeValue: unknown) {
  return String(timeValue || '').trim();
}

export function getLeadUniqueKeys(row: ExcelRow) {
  return {
    automationId: getLeadAutomationId(row),
    email: normalizeLeadEmail(row.email),
    dateOfDemo: normalizeLeadDate(row['Date of Demo']),
    timeOfDemo: normalizeLeadTime(row['Time of Demo'])
  };
}

export function getLeadAutomationId(row: ExcelRow) {
  return String(row.automation_id || row.automationId || '').trim();
}

function getCompatibleLeadDates(row: ExcelRow) {
  return Array.from(
    new Set([
      normalizeLeadDate(row['Date of Demo']),
      normalizeIsoDate(row['Date of Demo'])
    ].filter(Boolean))
  );
}

export function getLeadUserId(row: ExcelRow) {
  return getLeadAutomationId(row) || normalizeLeadEmail(row.email);
}

function nowIso() {
  return new Date().toISOString();
}

function getScheduledWindow(row: ExcelRow) {
  const start = parseExcelDateTime(row['Date of Demo'], row['Time of Demo']);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return {
    scheduledStartUtc: start.toISOString(),
    scheduledEndUtc: end.toISOString()
  };
}

function isActiveDemo(state: {
  status?: string | null;
  meetingLink?: string | null;
  calendarEventId?: string | null;
  demoStartUtc?: string | null;
  demoDate?: string | null;
  demoTime?: string | null;
}) {
  return (
    state.status === LEAD_STATUS.DEMO_SCHEDULED &&
    !!state.meetingLink &&
    !!state.calendarEventId &&
    !!state.demoDate &&
    !!state.demoTime
  );
}

function demoStartTime(state: { demoStartUtc?: string | null }) {
  const parsed = Date.parse(String(state.demoStartUtc || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPastBlockingWindow(state: { demoStartUtc?: string | null }) {
  const start = demoStartTime(state);
  return !!start && Date.now() > start + ACTIVE_DEMO_BLOCKING_WINDOW_MS;
}

function isDemoExpired(state: { demoStartUtc?: string | null }) {
  const start = demoStartTime(state);
  return !!start && Date.now() > start + ACTIVE_DEMO_AUTO_EXPIRE_MS;
}

async function expireActiveDemoState(
  state: {
    userId: string;
    email: string;
    activeDemoSessionId?: string | null;
    demoDate?: string | null;
    demoTime?: string | null;
  },
  remarks: string
) {
  const timestamp = nowIso();

  await prisma.$transaction(async (tx) => {
    if (state.activeDemoSessionId) {
      await tx.demoHistory.updateMany({
        where: { sessionId: state.activeDemoSessionId, status: LEAD_STATUS.DEMO_SCHEDULED },
        data: {
          status: DEMO_EXPIRED_STATUS,
          cancelledAt: timestamp
        }
      });
    }

    await tx.customerDemoState.update({
      where: { userId: state.userId },
      data: {
        status: DEMO_EXPIRED_STATUS,
        activeDemoSessionId: null,
        meetingLink: null,
        calendarEventId: null,
        demoStartUtc: null,
        demoEndUtc: null,
        demoDate: null,
        demoTime: null,
        timezone: null
      }
    });

    if (state.demoDate && state.demoTime) {
      await (tx.leadSchedule as any).updateMany({
        where: {
          OR: [
            {
              automationId: state.userId,
              dateOfDemo: { in: Array.from(new Set([normalizeLeadDate(state.demoDate), normalizeIsoDate(state.demoDate)].filter(Boolean))) },
              timeOfDemo: state.demoTime
            },
            {
              email: state.email,
              dateOfDemo: { in: Array.from(new Set([normalizeLeadDate(state.demoDate), normalizeIsoDate(state.demoDate)].filter(Boolean))) },
              timeOfDemo: state.demoTime
            }
          ]
        },
        data: {
          status: LEAD_STATUS.FOLLOW_UP,
          meetingLink: null,
          calendarEventId: null,
          remarks
        }
      });
    }
  });
}

export async function getCustomerDemoState(row: ExcelRow) {
  const userId = getLeadUserId(row);
  if (!userId) return null;
  return prisma.customerDemoState.findUnique({
    where: { userId },
    include: { demoHistory: { orderBy: { createdAt: 'desc' } } }
  });
}

export async function getActiveDemoForRow(row: ExcelRow) {
  const state = await getCustomerDemoState(row);
  if (!state || !isActiveDemo(state) || !state.activeDemoSessionId) return null;
  if (isDemoExpired(state)) {
    await expireActiveDemoState(state, 'Active demo expired automatically after 24 hours.');
    return null;
  }
  const history = await prisma.demoHistory.findUnique({
    where: { sessionId: state.activeDemoSessionId }
  });
  return { state, history };
}

export async function assertCanCreateOrReuseActiveDemo(row: ExcelRow) {
  const active = await getActiveDemoForRow(row);
  if (!active) return null;

  const sameSlot =
    normalizeLeadDate(row['Date of Demo']) === normalizeLeadDate(active.state.demoDate) &&
    normalizeLeadTime(row['Time of Demo']) === active.state.demoTime;

  if (!sameSlot) {
    if (isPastBlockingWindow(active.state)) {
      await expireActiveDemoState(
        active.state,
        'Previous active demo expired because its active window passed.'
      );
      return null;
    }
    throw new Error('This customer already has an active demo.');
  }

  return active;
}

export async function ensureScheduledDemoHistory(
  row: ExcelRow,
  data: {
    meetingLink: string;
    calendarEventId: string;
    scheduledEmailSentAt?: string;
  },
  options?: { sourceType?: string; sourceId?: string; emailBrand?: EmailBrandKey }
) {
  const userId = getLeadUserId(row);
  if (!userId || !data.meetingLink || !data.calendarEventId) return null;

  const displayDate = normalizeLeadDate(row['Date of Demo']);
  const displayTime = normalizeLeadTime(row['Time of Demo']);
  const email = normalizeLeadEmail(row.email);
  const { scheduledStartUtc, scheduledEndUtc } = getScheduledWindow(row);
  const timestamp = nowIso();
  const emailBrand = coerceStoredEmailBrand(options?.emailBrand);

  return prisma.$transaction(async (tx) => {
    const existingState = await tx.customerDemoState.findUnique({ where: { userId } });
    let canReuseExistingActiveDemo = !!existingState && isActiveDemo(existingState);
    if (existingState && canReuseExistingActiveDemo) {
      const sameSlot =
        normalizeLeadDate(existingState.demoDate) === displayDate &&
        existingState.demoTime === displayTime;
      const sameMeeting =
        existingState.meetingLink === data.meetingLink &&
        existingState.calendarEventId === data.calendarEventId;

      if (!sameSlot && !sameMeeting) {
        if (isPastBlockingWindow(existingState)) {
          canReuseExistingActiveDemo = false;
          if (existingState.activeDemoSessionId) {
            await tx.demoHistory.updateMany({
              where: { sessionId: existingState.activeDemoSessionId, status: LEAD_STATUS.DEMO_SCHEDULED },
              data: {
                status: DEMO_EXPIRED_STATUS,
                cancelledAt: timestamp
              }
            });
          }
          await tx.customerDemoState.update({
            where: { userId },
            data: {
              status: DEMO_EXPIRED_STATUS,
              activeDemoSessionId: null,
              meetingLink: null,
              calendarEventId: null,
              demoStartUtc: null,
              demoEndUtc: null,
              demoDate: null,
              demoTime: null,
              timezone: null
            }
          });
          await (tx.leadSchedule as any).updateMany({
            where: {
              OR: [
                {
                  automationId: existingState.userId,
                  dateOfDemo: { in: Array.from(new Set([normalizeLeadDate(existingState.demoDate), normalizeIsoDate(existingState.demoDate)].filter(Boolean))) },
                  timeOfDemo: existingState.demoTime || ''
                },
                {
                  email: existingState.email,
                  dateOfDemo: { in: Array.from(new Set([normalizeLeadDate(existingState.demoDate), normalizeIsoDate(existingState.demoDate)].filter(Boolean))) },
                  timeOfDemo: existingState.demoTime || ''
                }
              ]
            },
            data: {
              status: LEAD_STATUS.FOLLOW_UP,
              meetingLink: null,
              calendarEventId: null,
              remarks: 'Previous active demo expired because its active window passed.'
            }
          });
        } else {
          throw new Error('This customer already has an active demo.');
        }
      }
    }

    const sessionId =
      existingState?.activeDemoSessionId && canReuseExistingActiveDemo
        ? existingState.activeDemoSessionId
        : `demo_${randomUUID()}`;

    const state = await tx.customerDemoState.upsert({
      where: { userId },
      create: {
        emailBrand,
        userId,
        fullName: row.full_name || null,
        email,
        status: LEAD_STATUS.DEMO_SCHEDULED,
        activeDemoSessionId: sessionId,
        meetingLink: data.meetingLink,
        calendarEventId: data.calendarEventId,
        demoStartUtc: scheduledStartUtc,
        demoEndUtc: scheduledEndUtc,
        demoDate: displayDate,
        demoTime: displayTime,
        timezone: DEFAULT_TIMEZONE,
        sourceType: options?.sourceType || row.__sourceType || null,
        sourceId: options?.sourceId || row.__spreadsheetId || null,
        sheetRowNumber: row.__sheetRowNumber || row.__sourceRowNumber || null
      },
      update: {
        fullName: row.full_name || null,
        email,
        status: LEAD_STATUS.DEMO_SCHEDULED,
        activeDemoSessionId: sessionId,
        meetingLink: data.meetingLink,
        calendarEventId: data.calendarEventId,
        demoStartUtc: scheduledStartUtc,
        demoEndUtc: scheduledEndUtc,
        demoDate: displayDate,
        demoTime: displayTime,
        timezone: DEFAULT_TIMEZONE,
        sourceType: options?.sourceType || row.__sourceType || null,
        sourceId: options?.sourceId || row.__spreadsheetId || null,
        sheetRowNumber: row.__sheetRowNumber || row.__sourceRowNumber || null
      }
    });

    const history = await tx.demoHistory.upsert({
      where: { sessionId },
      create: {
        emailBrand,
        sessionId,
        userId,
        fullName: row.full_name || null,
        email,
        status: LEAD_STATUS.DEMO_SCHEDULED,
        scheduledStartUtc,
        scheduledEndUtc,
        displayDate,
        displayTime,
        timezone: DEFAULT_TIMEZONE,
        meetingLink: data.meetingLink,
        calendarEventId: data.calendarEventId,
        rescheduleCount: 0,
        scheduledEmailSentAt: data.scheduledEmailSentAt || null,
        scheduledAt: timestamp
      },
      update: {
        fullName: row.full_name || null,
        email,
        status: LEAD_STATUS.DEMO_SCHEDULED,
        scheduledStartUtc,
        scheduledEndUtc,
        displayDate,
        displayTime,
        timezone: DEFAULT_TIMEZONE,
        meetingLink: data.meetingLink,
        calendarEventId: data.calendarEventId,
        scheduledEmailSentAt: data.scheduledEmailSentAt || undefined
      }
    });

    return { state, history };
  });
}

export async function forceCloseActiveDemoForRow(row: ExcelRow, remarks?: string) {
  const userId = getLeadUserId(row);
  if (!userId) throw new Error('Email is missing.');

  const state = await prisma.customerDemoState.findUnique({ where: { userId } });
  if (!state?.activeDemoSessionId || !isActiveDemo(state)) {
    throw new Error('No active demo session exists.');
  }

  const message = remarks?.trim() || 'Previous active demo force closed by user.';
  await expireActiveDemoState(state, message);

  return {
    ...row,
    'Meeting Details': '',
    lead_status: LEAD_STATUS.DEMO_SCHEDULED,
    Remarks: `${message} You can schedule this lead again.`
  } satisfies ExcelRow;
}

export async function markScheduledEmailSent(row: ExcelRow, sentAt = nowIso()) {
  const active = await getActiveDemoForRow(row);
  if (!active?.state.activeDemoSessionId) return null;
  return prisma.demoHistory.update({
    where: { sessionId: active.state.activeDemoSessionId },
    data: { scheduledEmailSentAt: sentAt }
  });
}

export async function rescheduleActiveDemoForRow(
  row: ExcelRow,
  data: {
    meetingLink: string;
    calendarEventId: string;
  }
) {
  const userId = getLeadUserId(row);
  if (!userId) throw new Error('Email is missing.');
  if (!data.meetingLink || !data.calendarEventId) {
    throw new Error('An active meeting link and calendar event ID are required to reschedule.');
  }

  const displayDate = normalizeLeadDate(row['Date of Demo']);
  const displayTime = normalizeLeadTime(row['Time of Demo']);
  const { scheduledStartUtc, scheduledEndUtc } = getScheduledWindow(row);

  return prisma.$transaction(async (tx) => {
    const state = await tx.customerDemoState.findUnique({ where: { userId } });
    if (!state?.activeDemoSessionId) {
      throw new Error('No active demo session exists.');
    }
    if (!isActiveDemo(state)) {
      throw new Error('An active demo is required to reschedule.');
    }

    const history = await tx.demoHistory.findUnique({
      where: { sessionId: state.activeDemoSessionId }
    });
    if (!history || history.status !== LEAD_STATUS.DEMO_SCHEDULED) {
      throw new Error('Active demo history record is not schedulable.');
    }

    const updatedState = await tx.customerDemoState.update({
      where: { userId },
      data: {
        fullName: row.full_name || state.fullName,
        status: LEAD_STATUS.DEMO_SCHEDULED,
        meetingLink: data.meetingLink,
        calendarEventId: data.calendarEventId,
        demoStartUtc: scheduledStartUtc,
        demoEndUtc: scheduledEndUtc,
        demoDate: displayDate,
        demoTime: displayTime,
        timezone: DEFAULT_TIMEZONE
      }
    });

    const updatedHistory = await tx.demoHistory.update({
      where: { sessionId: state.activeDemoSessionId },
      data: {
        fullName: row.full_name || history.fullName,
        status: LEAD_STATUS.DEMO_SCHEDULED,
        scheduledStartUtc,
        scheduledEndUtc,
        displayDate,
        displayTime,
        timezone: DEFAULT_TIMEZONE,
        meetingLink: data.meetingLink,
        calendarEventId: data.calendarEventId,
        rescheduleCount: { increment: 1 }
      }
    });

    return { state: updatedState, history: updatedHistory };
  });
}

export async function closeActiveDemoForRow(
  row: ExcelRow,
  status: typeof LEAD_STATUS.DEMO_DONE | typeof LEAD_STATUS.NO_RESPONSE,
  options?: { emailSentAt?: string }
) {
  const userId = getLeadUserId(row);
  if (!userId) throw new Error('Email is missing.');
  const timestamp = nowIso();

  return prisma.$transaction(async (tx) => {
    const state = await tx.customerDemoState.findUnique({ where: { userId } });
    if (!state?.activeDemoSessionId) {
      throw new Error('No active demo session exists.');
    }
    if (!state.meetingLink || !state.calendarEventId) {
      throw new Error('An active meeting is required to close this demo.');
    }

    const history = await tx.demoHistory.findUnique({
      where: { sessionId: state.activeDemoSessionId }
    });
    if (!history) throw new Error('Active demo history record was not found.');

    const historyData =
      status === LEAD_STATUS.DEMO_DONE
        ? {
            status,
            completedAt: history.completedAt || timestamp,
            demoDoneEmailSentAt: options?.emailSentAt || history.demoDoneEmailSentAt || null
          }
        : {
            status,
            noResponseAt: history.noResponseAt || timestamp,
            noResponseEmailSentAt: options?.emailSentAt || history.noResponseEmailSentAt || null
          };

    const updatedHistory = await tx.demoHistory.update({
      where: { sessionId: state.activeDemoSessionId },
      data: historyData
    });

    const updatedState = await tx.customerDemoState.update({
      where: { userId },
      data: {
        status,
        activeDemoSessionId: null,
        meetingLink: null,
        calendarEventId: null,
        demoStartUtc: null,
        demoEndUtc: null,
        demoDate: null,
        demoTime: null,
        timezone: null
      }
    });

    return { state: updatedState, history: updatedHistory };
  });
}

export function getSheetRowKey(row: ExcelRow) {
  const spreadsheetId = String(row.__spreadsheetId || '').trim();
  const sheetName = String(row.__sheetName || '').trim();
  const sheetRowNumber = Number(row.__sheetRowNumber || row.__sourceRowNumber || 0);
  if (!spreadsheetId || !sheetName || !sheetRowNumber) return '';
  return `${spreadsheetId}|${sheetName}|${sheetRowNumber}`;
}

export async function saveSheetLeadState(
  row: ExcelRow,
  data: {
    lastLeadStatus?: string | null;
    lastMeetingDate?: string | null;
    lastMeetingTime?: string | null;
    lastMeetingLink?: string | null;
    lastAction?: string;
    lastActionStatus?: string;
    lastError?: string | null;
  } = {},
  emailBrand?: EmailBrandKey
) {
  const sheetRowKey = getSheetRowKey(row);
  if (!sheetRowKey || !row.__spreadsheetId || !row.__sheetName) return null;
  const normalizedBrand = coerceStoredEmailBrand(emailBrand);

  const lastLeadStatus = data.lastLeadStatus ?? (String(row.lead_status || '') || null);
  const lastMeetingDate = data.lastMeetingDate ?? (normalizeLeadDate(row['Date of Demo']) || null);
  const lastMeetingTime = data.lastMeetingTime ?? (normalizeLeadTime(row['Time of Demo']) || null);
  const lastMeetingLink = data.lastMeetingLink ?? (String(row['Meeting Details'] || '') || null);

  return prisma.sheetLeadState.upsert({
    where: { sheetRowKey },
    create: {
      emailBrand: normalizedBrand,
      sheetRowKey,
      spreadsheetId: row.__spreadsheetId,
      sheetName: row.__sheetName,
      sheetRowNumber: Number(row.__sheetRowNumber || row.__sourceRowNumber),
      email: normalizeLeadEmail(row.email) || null,
      lastLeadStatus,
      lastMeetingDate,
      lastMeetingTime,
      lastMeetingLink,
      lastAction: data.lastAction || null,
      lastActionStatus: data.lastActionStatus || null,
      lastError: data.lastError || null
    },
    update: {
      email: normalizeLeadEmail(row.email) || null,
      lastLeadStatus,
      lastMeetingDate,
      lastMeetingTime,
      lastMeetingLink,
      lastAction: data.lastAction || undefined,
      lastActionStatus: data.lastActionStatus || undefined,
      lastError: data.lastError === undefined ? undefined : data.lastError
    }
  });
}

export async function getSheetLeadState(row: ExcelRow) {
  const sheetRowKey = getSheetRowKey(row);
  if (!sheetRowKey) return null;
  return prisma.sheetLeadState.findUnique({ where: { sheetRowKey } });
}

export async function findLeadSchedule(row: ExcelRow) {
  const keys = getLeadUniqueKeys(row);
  if (!keys.email || !keys.dateOfDemo || !keys.timeOfDemo) {
    return null;
  }

  const dateMatches = getCompatibleLeadDates(row);
  const orConditions: any[] = [];
  if (keys.automationId) {
    orConditions.push({
      automationId: keys.automationId,
      dateOfDemo: { in: dateMatches },
      timeOfDemo: keys.timeOfDemo
    });
  }
  orConditions.push({
    email: keys.email,
    dateOfDemo: { in: dateMatches },
    timeOfDemo: keys.timeOfDemo
  });

  return (prisma.leadSchedule as any).findFirst({
    where: {
      OR: orConditions
    },
    orderBy: { updatedAt: 'desc' }
  });
}

async function saveLeadScheduleRow(
  row: ExcelRow,
  data: {
    meetingLink?: string | null;
    calendarEventId?: string | null;
    gmailMessageId?: string | null;
    status: string;
    remarks?: string | null;
  },
  options?: { sourceType?: string; sourceId?: string; emailBrand?: EmailBrandKey }
) {
  const keys = getLeadUniqueKeys(row);
  if (!keys.email || !keys.dateOfDemo || !keys.timeOfDemo) return null;

  const existing = await findLeadSchedule(row);
  const emailBrand = coerceStoredEmailBrand(options?.emailBrand);
  const writeData = {
    automationId: keys.automationId || null,
    fullName: row.full_name || null,
    email: keys.email,
    dateOfDemo: keys.dateOfDemo,
    timeOfDemo: keys.timeOfDemo,
    meetingLink: data.meetingLink ?? null,
    calendarEventId: data.calendarEventId === undefined ? undefined : data.calendarEventId || null,
    gmailMessageId: data.gmailMessageId === undefined ? undefined : data.gmailMessageId || null,
    status: data.status,
    remarks: data.remarks || null,
    sourceType: options?.sourceType || row.__sourceType || null,
    sourceId: options?.sourceId || row.__spreadsheetId || null,
    sheetRowNumber: row.__sheetRowNumber || row.__sourceRowNumber || null
  };

  if (existing?.id) {
    return (prisma.leadSchedule as any).update({
      where: { id: existing.id },
      data: writeData
    });
  }

  return (prisma.leadSchedule as any).create({
    data: {
      ...writeData,
      emailBrand
    }
  });
}

function isOutcomeRequest(status: string) {
  return (
    status === LEAD_STATUS.RESCHEDULE ||
    status === LEAD_STATUS.DEMO_DONE ||
    status === LEAD_STATUS.NO_RESPONSE
  );
}

function isTerminalStatus(status: string) {
  return status === LEAD_STATUS.DEMO_DONE || status === LEAD_STATUS.NO_RESPONSE;
}

export async function applyDbTruthToRow(row: ExcelRow): Promise<ExcelRow> {
  const requestedStatus = normalizeLeadStatus(row.lead_status);
  const active = await getActiveDemoForRow(row);
  const rowDate = normalizeLeadDate(row['Date of Demo']);
  const rowTime = normalizeLeadTime(row['Time of Demo']);

  if (active?.state) {
    const sameSlot =
      normalizeLeadDate(active.state.demoDate) === rowDate &&
      active.state.demoTime === rowTime;
    if (sameSlot) {
      const activeAutomationId = active.state.userId.includes('@') ? '' : active.state.userId;
      return {
        ...row,
        'Meeting Details': active.state.meetingLink || row['Meeting Details'] || '',
        lead_status: isOutcomeRequest(requestedStatus) ? requestedStatus : LEAD_STATUS.DEMO_SCHEDULED,
        Remarks: isOutcomeRequest(requestedStatus)
          ? row.Remarks || ''
          : row.Remarks || 'Active demo from database',
        automation_id: activeAutomationId || row.automation_id || '',
        __automationIdRestoredFromDb: !!activeAutomationId && activeAutomationId !== row.automation_id
      };
    }

    if (requestedStatus === LEAD_STATUS.DEMO_SCHEDULED) {
      if (isPastBlockingWindow(active.state)) {
        await expireActiveDemoState(
          active.state,
          'Previous active demo expired because its active window passed.'
        );
      } else {
      return {
        ...row,
        __schedulerStatus: 'Failed',
        Remarks: 'This customer already has an active demo.'
      };
      }
    }
  }

  const schedule = await findLeadSchedule(row);
  if (!schedule) return row;

  const dbStatus = normalizeLeadStatus(schedule.status) || schedule.status;
  const terminalStatus = isTerminalStatus(dbStatus);
  const shouldUseDbStatus =
    terminalStatus ||
    dbStatus === LEAD_STATUS.DEMO_SCHEDULED ||
    dbStatus === 'Failed' ||
    !isOutcomeRequest(requestedStatus);

  const restoredAutomationId = schedule.automationId || row.automation_id || '';

  return {
    ...row,
    full_name: row.full_name || schedule.fullName || '',
    email: row.email || schedule.email,
    'Date of Demo': normalizeLeadDate(schedule.dateOfDemo || row['Date of Demo']),
    'Time of Demo': schedule.timeOfDemo || row['Time of Demo'],
    'Meeting Details': schedule.meetingLink || '',
    lead_status: shouldUseDbStatus ? dbStatus : requestedStatus,
    automation_id: restoredAutomationId,
    Remarks: schedule.remarks || row.Remarks || '',
    __dbFinalState: terminalStatus || dbStatus === LEAD_STATUS.DEMO_SCHEDULED || row.__dbFinalState,
    __automationIdRestoredFromDb: !!schedule.automationId && schedule.automationId !== row.automation_id,
    __schedulerStatus: dbStatus === 'Failed' ? 'Failed' : row.__schedulerStatus
  };
}

export async function applyDbTruthToRows(rows: ExcelRow[]) {
  return Promise.all(rows.map((row) => applyDbTruthToRow(row)));
}

export async function saveLeadScheduleFailure(
  row: ExcelRow,
  remarks: string,
  options?: {
    sourceType?: string;
    sourceId?: string;
    status?: string;
    meetingLink?: string;
    calendarEventId?: string;
    gmailMessageId?: string;
    emailBrand?: EmailBrandKey;
  }
) {
  const keys = getLeadUniqueKeys(row);
  if (!keys.email || !keys.dateOfDemo || !keys.timeOfDemo) {
    return null;
  }
  const status = options?.status || 'Failed';
  const meetingLink = (options?.meetingLink ?? String(row['Meeting Details'] || '')) || null;

  return saveLeadScheduleRow(
    row,
    {
      meetingLink,
      calendarEventId: options?.calendarEventId || null,
      gmailMessageId: options?.gmailMessageId || null,
      status,
      remarks
    },
    options
  );
}

export async function saveLeadScheduleSuccess(
  row: ExcelRow,
  data: {
    meetingLink: string;
    calendarEventId?: string;
    gmailMessageId?: string;
    remarks: string;
    status?: string;
  },
  options?: { sourceType?: string; sourceId?: string; emailBrand?: EmailBrandKey }
) {
  const keys = getLeadUniqueKeys(row);
  if (!keys.email || !keys.dateOfDemo || !keys.timeOfDemo) return null;

  return saveLeadScheduleRow(
    row,
    {
      meetingLink: data.meetingLink,
      calendarEventId: data.calendarEventId || null,
      gmailMessageId: data.gmailMessageId || null,
      status: data.status || 'Demo Scheduled',
      remarks: data.remarks
    },
    options
  );
}

export async function saveLeadStatusUpdate(
  row: ExcelRow,
  data: {
    status: string;
    remarks?: string;
  },
  options?: { sourceType?: string; sourceId?: string; emailBrand?: EmailBrandKey }
) {
  const keys = getLeadUniqueKeys(row);
  if (!keys.email || !keys.dateOfDemo || !keys.timeOfDemo) return null;

  return saveLeadScheduleRow(
    row,
    {
      meetingLink: row['Meeting Details'] || null,
      status: data.status,
      remarks: data.remarks || null
    },
    options
  );
}

export async function findScheduledMeetLinkFromDb(row: ExcelRow) {
  const existing = await findLeadSchedule(row);
  const scheduled =
    existing?.status === 'Demo Scheduled' ||
    existing?.status === 'Scheduled' ||
    existing?.status === 'Email Pending' ||
    existing?.status === 'Email Failed' ||
    existing?.status === 'Email Retry Pending' ||
    existing?.status === 'Email Unknown';
  if (scheduled && existing?.meetingLink) {
    return existing.meetingLink;
  }
  return '';
}
