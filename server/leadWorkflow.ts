import { ExcelRow, ScheduleSummary } from '../src/types';
import {
  parseExcelDateTime,
  scheduleMeeting,
  sendGmailInvite,
  sendGmailRescheduleInvite,
  sendNoResponseEmail,
  sendThankYouEmail,
  updateCalendarMeeting
} from './googleAuth';
import {
  friendlySheetsError,
  updateGoogleSheetRow,
  updateGoogleSheetRowsResilient,
  type GoogleSheetAccessContext,
  type GoogleSheetRowUpdate
} from './googleSheets';
import { EMAIL_LOG_TYPES } from './emailLog';
import { LEAD_STATUS, isDemoScheduledStatus, normalizeLeadStatus } from './leadStatus';
import {
  findScheduledMeetLinkFromDb,
  assertCanCreateOrReuseActiveDemo,
  assertDemoLifecycleOwnership,
  closeActiveDemoForRow,
  ensureScheduledDemoHistory,
  getSheetLeadState,
  markScheduledEmailSent,
  markOutcomeEmailSent,
  normalizeLeadDate,
  normalizeLeadTime,
  rescheduleActiveDemoForRow,
  saveLeadScheduleFailure,
  saveLeadScheduleSuccess,
  saveSheetLeadState,
  saveLeadStatusUpdate
} from './scheduleDb';
import { assertProcessBatchLifecycleOwnership } from './lifecycleOwnership';
import { addScheduledReminder, invalidateScheduledReminder } from './reminders';
import {
  buildMeetingInviteEmail,
  buildNoResponseEmail,
  buildRescheduleEmail,
  buildThankYouEmail
} from './emailTemplates';
import { coerceStoredEmailBrand, type EmailBrandKey } from '../src/lib/emailBrand';
import {
  parseSenderAccountKey,
  type SenderAccountKey
} from '../src/lib/senderAccount';
import {
  claimEmailRetryById,
  claimEmailDelivery,
  createPendingEmailDeliveryIntent,
  findEmailDeliveryById,
  findEmailDeliveryByEventKey,
  EMAIL_DELIVERY_STATUS,
  markEmailDeliveryFailed,
  markEmailSheetSyncFailed,
  markEmailSheetSyncSucceeded,
  markEmailDeliverySent
} from './emailDelivery';
import { enqueueSheetSyncJob } from './sheetSyncQueue';
import { isStaleWorkflowGenerationError } from './workflowControl';
import {
  createEmailEventKey,
  createEmailPayloadHash,
  EMAIL_TYPES,
  getAutomationId,
  type EmailType
} from './emailIdentity';
import { normalizeDisplayDate } from '../src/lib/dateFormat';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PROCESS_DELAY_MS = 1000;
const RESCHEDULE_ACTION = 'RESCHEDULE';
const CALENDAR_BLOCK_COOLDOWN_MS = 60 * 60 * 1000;
let calendarBlockedUntil = 0;

const STATUS_ONLY_VALUES = new Set<string>([
  LEAD_STATUS.NO_RESPONSE,
  LEAD_STATUS.FOLLOW_UP,
  LEAD_STATUS.TO_BE_CALLED,
  LEAD_STATUS.NOT_REQUIRED,
  LEAD_STATUS.REPEATED
]);

export const hasGoogleMeetLink = (value: unknown) => /meet\.google\.com/i.test(String(value || ''));

export const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export type SheetContext = {
  sourceType: 'excel' | 'google-sheet';
  spreadsheetId?: string;
  sheetName?: string;
  headers?: string[];
  workspaceKey: EmailBrandKey;
  senderAccountKey: SenderAccountKey;
  googleAccountKey: SenderAccountKey;
  emailBrandKey: EmailBrandKey;
  /** Business/workflow owner used for database scoping and duplicate prevention. */
  emailBrand: EmailBrandKey;
  assertStillCurrent?: () => void | Promise<void>;
  onRowProcessed?: (row: ExcelRow, summary: ProcessLeadsResult['summary']) => void | Promise<void>;
};

type WorkflowOptions = {
  skipSheetSync?: boolean;
};

function senderAccountKeyForContext(context: SheetContext): SenderAccountKey {
  return parseSenderAccountKey(context.senderAccountKey);
}

function googleSheetAccessForContext(context: SheetContext): GoogleSheetAccessContext {
  return {
    workspaceKey: coerceStoredEmailBrand(context.workspaceKey),
    googleAccountKey: parseSenderAccountKey(context.googleAccountKey)
  };
}

function emailBrandKeyForContext(context: SheetContext): EmailBrandKey {
  return coerceStoredEmailBrand(context.emailBrandKey || context.emailBrand);
}

function contextForOwnerBrand(
  context: SheetContext,
  emailBrand: EmailBrandKey,
  senderAccountKey: string | null
): SheetContext {
  return {
    ...context,
    senderAccountKey: parseSenderAccountKey(senderAccountKey),
    emailBrand,
    emailBrandKey: emailBrand
  };
}

type PlannedRow = {
  row: ExcelRow;
  reason?: string;
};

type TimeConflictGroup = {
  key: string;
  date: string;
  time: string;
  count: number;
  names: string[];
  rowIds: string[];
};

export type ProcessLeadPlan = {
  demoScheduledRows: ExcelRow[];
  rescheduleRows: ExcelRow[];
  demoDoneRows: ExcelRow[];
  statusOnlyRows: ExcelRow[];
  invalidRows: PlannedRow[];
  skippedRows: PlannedRow[];
  timeConflictRows: PlannedRow[];
  timeConflictGroups: TimeConflictGroup[];
  meetingRecipients: string[];
  thankYouRecipients: string[];
  noResponseRecipients: string[];
  estimatedTime: {
    minMinutes: number;
    maxMinutes: number;
    label: string;
  };
  summary: {
    total: number;
    demoScheduled: number;
    reschedule: number;
    demoDone: number;
    noResponse: number;
    statusOnly: number;
    invalid: number;
    skipped: number;
    timeConflicts: number;
    actionable: number;
  };
};

export type ProcessLeadsResult = {
  rows: ExcelRow[];
  sheetSyncError?: string;
  summary: {
    total: number;
    demoScheduled: number;
    reschedule: number;
    demoDone: number;
    noResponse: number;
    statusOnly: number;
    invalid: number;
    failed: number;
    skipped: number;
    timeConflicts: number;
  };
  groups?: {
    demoScheduledRows: ExcelRow[];
    rescheduleRows: ExcelRow[];
    demoDoneRows: ExcelRow[];
    statusOnlyRows: ExcelRow[];
    invalidRows: ExcelRow[];
    skippedRows: ExcelRow[];
  };
};

export function normalizeWorkflowStatus(value: unknown) {
  return normalizeLeadStatus(value);
}

export function isStatusOnlyStatus(value: unknown) {
  const normalized = normalizeLeadStatus(value);
  return normalized !== '' && STATUS_ONLY_VALUES.has(normalized);
}

const pad = (value: number) => String(value).padStart(2, '0');
const TIME_CONFLICT_REMARK = 'Time conflict: another lead has the same date and time';

function normalizeMeetingDate(value: unknown) {
  return normalizeDisplayDate(value);
}

function normalizeMeetingTime(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const totalMinutes = Math.round(value * 24 * 60);
    return `${pad(Math.floor(totalMinutes / 60) % 24)}:${pad(totalMinutes % 60)}`;
  }

  const raw = String(value || '').trim();
  if (!raw) return '';

  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/i);
  if (match) {
    let hours = Number(match[1]);
    const minutes = Number(match[2] || 0);
    const suffix = match[3]?.toLowerCase();
    if (suffix === 'pm' && hours < 12) hours += 12;
    if (suffix === 'am' && hours === 12) hours = 0;
    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      return `${pad(hours)}:${pad(minutes)}`;
    }
  }

  return raw.toLowerCase().replace(/\s+/g, ' ');
}

function isMeetingAction(row: ExcelRow) {
  const normalized = normalizeLeadStatus(row.lead_status);
  return normalized === LEAD_STATUS.DEMO_SCHEDULED || normalized === LEAD_STATUS.RESCHEDULE;
}

function getMeetingTimeKey(row: ExcelRow) {
  const date = normalizeMeetingDate(row['Date of Demo']);
  const time = normalizeMeetingTime(row['Time of Demo']);
  return date && time ? `${date}__${time}` : '';
}

export function findTimeConflictGroups(rows: ExcelRow[]): TimeConflictGroup[] {
  const groups = new Map<string, ExcelRow[]>();

  for (const row of rows) {
    if (!isMeetingAction(row)) continue;
    const key = getMeetingTimeKey(row);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), row]);
  }

  return Array.from(groups.entries())
    .filter(([, groupRows]) => groupRows.length > 1)
    .map(([key, groupRows]) => {
      const [date, time] = key.split('__');
      return {
        key,
        date,
        time,
        count: groupRows.length,
        names: groupRows.map((row) => String(row.full_name || row.email || row.id || 'Lead')).slice(0, 5),
        rowIds: groupRows.map((row) => row.id)
      };
    });
}

function failureRow(row: ExcelRow, message: string): ExcelRow {
  return {
    ...row,
    __schedulerStatus: 'Failed',
    Remarks: message
  };
}

function estimateProcessingTime(demoScheduled: number, demoDone: number, statusOnly: number) {
  const minSeconds = demoScheduled * 5 + demoDone * 3 + statusOnly * 0.1;
  const maxSeconds = demoScheduled * 8 + demoDone * 5 + statusOnly * 0.2;
  const minMinutes = Math.max(0, Math.ceil(minSeconds / 60));
  const maxMinutes = Math.max(minMinutes, Math.ceil(maxSeconds / 60));

  return {
    minMinutes,
    maxMinutes,
    label:
      maxMinutes <= 1
        ? 'under 1 minute'
        : minMinutes === maxMinutes
          ? `${maxMinutes} minutes`
          : `${minMinutes}-${maxMinutes} minutes`
  };
}

function validateDemoScheduledRow(row: ExcelRow) {
  const email = String(row.email || '').trim();
  if (!email) return 'Email is missing.';
  if (!isValidEmail(email)) return 'Email is invalid.';
  if (!row['Date of Demo']) return 'Date of Demo is missing.';
  if (!row['Time of Demo']) return 'Time of Demo is missing.';

  try {
    const startTime = parseExcelDateTime(row['Date of Demo'], row['Time of Demo']);
    if (startTime.getTime() <= Date.now()) {
      return 'Meeting date/time is in the past. Choose a future Date of Demo and Time of Demo.';
    }
  } catch (err: unknown) {
    return err instanceof Error ? err.message : 'Date or time is invalid.';
  }

  return '';
}

function getInvalidLeadStatusReason(row: ExcelRow) {
  const raw = String(row.lead_status ?? '').trim();
  return raw ? `Invalid lead_status: ${raw}` : 'lead_status is missing';
}

function validateDemoDoneRow(row: ExcelRow) {
  const email = String(row.email || '').trim();
  if (!email) return 'Email is missing.';
  if (!isValidEmail(email)) return 'Email is invalid.';
  return '';
}

function hasMeetingStarted(startUtc?: string | null) {
  if (!startUtc) return false;
  const time = Date.parse(startUtc);
  return Number.isFinite(time) && time <= Date.now();
}

async function assertManualCloseAllowed(row: ExcelRow, context: SheetContext) {
  const active = await assertDemoLifecycleOwnership(row, context.emailBrand, senderAccountKeyForContext(context));
  if (!active.state.meetingLink || !active.state.calendarEventId) {
    throw new Error('An active meeting is required to update this demo.');
  }
  const scheduledStartUtc = active.history?.scheduledStartUtc || active.state.demoStartUtc;
  if (!hasMeetingStarted(scheduledStartUtc)) {
    throw new Error('The scheduled meeting start time has not arrived yet.');
  }
  return active;
}

function sheetRowNumber(row: ExcelRow) {
  return Number(row.__sheetRowNumber || row.__sourceRowNumber || 0);
}

function collectSheetUpdate(
  updates: GoogleSheetRowUpdate[],
  row: ExcelRow,
  values: Record<string, any>
) {
  const rowNumber = sheetRowNumber(row);
  if (!rowNumber || rowNumber < 2) return;
  updates.push({
    rowNumber,
    emailDeliveryId: String(row.__emailDeliveryId || '') || undefined,
    dataSourceId: row.__sourceId,
    sourceTabId: row.__sourceTabId,
    sourceRowId: row.__sourceRowId,
    values: {
      ...values,
      ...(row.automation_id && values.automation_id === undefined ? { automation_id: row.automation_id } : {})
    }
  });
}

function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  if (!domain) return 'invalid-email';
  return `${name.slice(0, 2)}***@${domain}`;
}

function scheduleFailureStatus(message: string) {
  if (/temporarily restricted|quotaExceeded|usage limits/i.test(message)) {
    return 'Manual Link Required';
  }
  if (/Gmail invitation failed.*rate limit|Gmail invitation failed.*429|Gmail invitation failed.*5\d\d/i.test(message)) {
    return 'Email Retry Pending';
  }
  if (/Gmail invitation failed|Gmail send returned no message ID/i.test(message)) {
    return 'Email Failed';
  }
  return 'Failed';
}

function isCalendarQuotaBlocked(message: string) {
  return /temporarily restricted|quotaExceeded|usage limits/i.test(message);
}

function calendarBlockedMessage() {
  return 'Calendar event creation blocked: Google Calendar is temporarily restricted. Add a Meet link manually or retry later.';
}

function markCalendarBlocked() {
  calendarBlockedUntil = Date.now() + CALENDAR_BLOCK_COOLDOWN_MS;
}

function isCalendarBlocked() {
  return Date.now() < calendarBlockedUntil;
}

type IdempotentEmailInput = {
  row: ExcelRow;
  context: SheetContext;
  emailType: EmailType;
  sessionId?: unknown;
  date?: unknown;
  time?: unknown;
  reminderWindow?: string;
  subject: string;
  text: string;
  html: string;
  send: () => Promise<{ messageId: string; threadId?: string }>;
};

async function assertWorkflowStillValid(context?: Pick<SheetContext, 'assertStillCurrent'>) {
  await context?.assertStillCurrent?.();
}

async function getEmailEventState(input: {
  row: ExcelRow;
  context: SheetContext;
  emailType: EmailType;
  sessionId?: unknown;
  date?: unknown;
  time?: unknown;
  reminderWindow?: string;
}) {
  const automationId = getAutomationId(input.row, input.context);
  const eventKey = createEmailEventKey({
    automationId,
    recipient: input.row.email,
    emailType: input.emailType,
    sessionId: input.sessionId,
    date: input.date,
    time: input.time,
    reminderWindow: input.reminderWindow
  });
  const delivery = await findEmailDeliveryByEventKey(input.context.emailBrand, eventKey);

  return { automationId, eventKey, delivery };
}

async function sendIdempotentEmail(input: IdempotentEmailInput) {
  const recipient = String(input.row.email || '').trim().toLowerCase();
  const automationId = getAutomationId(input.row, input.context);
  const eventKey = createEmailEventKey({
    automationId,
    recipient,
    emailType: input.emailType,
    sessionId: input.sessionId,
    date: input.date,
    time: input.time,
    reminderWindow: input.reminderWindow
  });
  const payloadHash = createEmailPayloadHash({
    recipient,
    subject: input.subject,
    text: input.text,
    html: input.html
  });

  await assertWorkflowStillValid(input.context);
  const claim = await claimEmailDelivery({
    emailBrand: input.context.emailBrand,
    senderAccountKey: senderAccountKeyForContext(input.context),
    eventKey,
    automationId,
    emailType: input.emailType,
    demoSessionId: String(input.sessionId || '') || null,
    recipient,
    payloadHash,
    subject: input.subject,
    text: input.text,
    html: input.html
  });

  if (claim.claimed === false) {
    console.log('EMAIL_SKIPPED', {
      eventKey,
      automationId,
      recipient: maskEmail(recipient),
      emailType: input.emailType,
      reason: claim.reason,
      providerMessageId: claim.providerMessageId || undefined
    });

    return {
      sent: false as const,
      skipped: true as const,
      reason: claim.reason,
      deliveryId: claim.deliveryId,
      messageId: claim.providerMessageId || undefined
    };
  }

  console.log('EMAIL_SEND_STARTED', {
    eventKey,
    automationId,
    recipient: maskEmail(recipient),
    emailType: input.emailType,
    attempt: claim.attemptCount
  });

  try {
    await assertWorkflowStillValid(input.context);
    const result = await input.send();
    if (!result.messageId) {
      throw new Error('Gmail send returned no message ID.');
    }

    await assertWorkflowStillValid(input.context);
    await markEmailDeliverySent({
      deliveryId: claim.deliveryId,
      providerMessageId: result.messageId
    });

    console.log('EMAIL_SEND_SUCCESS', {
      eventKey,
      automationId,
      recipient: maskEmail(recipient),
      emailType: input.emailType,
      messageId: result.messageId
    });

    return {
      sent: true as const,
      skipped: false as const,
      deliveryId: claim.deliveryId,
      messageId: result.messageId
    };
  } catch (error) {
    if (isStaleWorkflowGenerationError(error)) {
      throw error;
    }
    await assertWorkflowStillValid(input.context);
    const classification = await markEmailDeliveryFailed({
      deliveryId: claim.deliveryId,
      error
    });

    console.error('EMAIL_SEND_FAILED', {
      eventKey,
      automationId,
      recipient: maskEmail(recipient),
      emailType: input.emailType,
      classification,
      error: error instanceof Error ? error.message : String(error)
    });

    throw error;
  }
}

function terminalEmailMessage(status: typeof LEAD_STATUS.DEMO_DONE | typeof LEAD_STATUS.NO_RESPONSE, result: {
  sent?: boolean;
  classification?: string;
  existingStatus?: string;
}) {
  const lifecycle = status === LEAD_STATUS.DEMO_DONE ? 'Demo completed' : 'Not Attended recorded';
  const emailName = status === LEAD_STATUS.DEMO_DONE ? 'Thank-you email' : 'Not Attended email';
  if (result.sent) return `${lifecycle}. ${emailName} sent.`;
  if (result.existingStatus === EMAIL_DELIVERY_STATUS.SENT) return `${lifecycle}. ${emailName} already sent.`;
  if (result.classification === 'RETRY_PENDING' || result.existingStatus === EMAIL_DELIVERY_STATUS.RETRY_PENDING || result.existingStatus === EMAIL_DELIVERY_STATUS.PENDING) {
    return `${lifecycle}. ${emailName} queued for retry.`;
  }
  return `${lifecycle}. ${emailName} requires manual review.`;
}

async function sendPendingOutcomeEmail(input: {
  context: SheetContext;
  deliveryId: string;
  sessionId: string;
  recipient: string;
  status: typeof LEAD_STATUS.DEMO_DONE | typeof LEAD_STATUS.NO_RESPONSE;
  send: () => Promise<{ messageId: string; threadId?: string }>;
}) {
  await assertWorkflowStillValid(input.context);
  const delivery = await findEmailDeliveryById(input.deliveryId);
  if (!delivery) {
    return {
      sent: false,
      message: terminalEmailMessage(input.status, { existingStatus: EMAIL_DELIVERY_STATUS.UNKNOWN })
    };
  }
  if (delivery.status === EMAIL_DELIVERY_STATUS.SENT) {
    await assertWorkflowStillValid(input.context);
    await markOutcomeEmailSent(input.sessionId, input.status);
    return {
      sent: false,
      messageId: delivery.providerMessageId || undefined,
      message: terminalEmailMessage(input.status, { existingStatus: delivery.status })
    };
  }

  await assertWorkflowStillValid(input.context);
  const claimed = await claimEmailRetryById(input.deliveryId);
  if (!claimed) {
    const refreshed = await findEmailDeliveryById(input.deliveryId);
    return {
      sent: false,
      message: terminalEmailMessage(input.status, { existingStatus: refreshed?.status || delivery.status })
    };
  }

  try {
    await assertWorkflowStillValid(input.context);
    const result = await input.send();
    if (!result.messageId) throw new Error('Gmail send returned no message ID.');
    await assertWorkflowStillValid(input.context);
    await markEmailDeliverySent({
      deliveryId: input.deliveryId,
      providerMessageId: result.messageId
    });
    await assertWorkflowStillValid(input.context);
    await markOutcomeEmailSent(input.sessionId, input.status);
    return {
      sent: true,
      messageId: result.messageId,
      message: terminalEmailMessage(input.status, { sent: true })
    };
  } catch (error) {
    const classification = await markEmailDeliveryFailed({
      deliveryId: input.deliveryId,
      error
    });
    return {
      sent: false,
      classification,
      message: terminalEmailMessage(input.status, { classification })
    };
  }
}

function flattenPlannedRows(items: PlannedRow[]) {
  return items.map((item) => ({
    ...item.row,
    reason: item.reason || '',
    Remarks: item.row.Remarks || item.reason || ''
  }));
}

export async function buildProcessLeadPlan(rows: ExcelRow[]): Promise<ProcessLeadPlan> {
  const plan: ProcessLeadPlan = {
    demoScheduledRows: [],
    rescheduleRows: [],
    demoDoneRows: [],
    statusOnlyRows: [],
    invalidRows: [],
    skippedRows: [],
    timeConflictRows: [],
    timeConflictGroups: [],
    meetingRecipients: [],
    thankYouRecipients: [],
    noResponseRecipients: [],
    estimatedTime: estimateProcessingTime(0, 0, 0),
    summary: {
      total: rows.length,
      demoScheduled: 0,
      reschedule: 0,
      demoDone: 0,
      noResponse: 0,
      statusOnly: 0,
      invalid: 0,
      skipped: 0,
      timeConflicts: 0,
      actionable: 0
    }
  };

  const timeConflictGroups = findTimeConflictGroups(rows);
  const conflictRowIds = new Set(timeConflictGroups.flatMap((group) => group.rowIds));
  if (timeConflictGroups.length > 0) {
    plan.timeConflictGroups = timeConflictGroups;
    plan.timeConflictRows = rows
      .filter((row) => conflictRowIds.has(row.id))
      .map((row) => ({
        row: failureRow(row, TIME_CONFLICT_REMARK),
        reason: TIME_CONFLICT_REMARK
      }));
    plan.summary.timeConflicts = plan.timeConflictRows.length;
  }

  for (const row of rows) {
    const normalized = normalizeLeadStatus(row.lead_status);

    if (row.__dbFinalState) {
      const reason = `${normalized || 'Lead'} already finalized in database.`;
      plan.skippedRows.push({
        row: {
          ...row,
          Remarks: row.Remarks || reason
        },
        reason
      });
      continue;
    }

    if (!normalized) {
      const reason = getInvalidLeadStatusReason(row);
      plan.invalidRows.push({
        row: failureRow(row, reason),
        reason
      });
      continue;
    }

    if (normalized === LEAD_STATUS.DEMO_SCHEDULED) {
      if (hasGoogleMeetLink(row['Meeting Details'])) {
        const reason = 'Already scheduled, skipped';
        plan.skippedRows.push({
          row: {
            ...row,
            lead_status: LEAD_STATUS.DEMO_SCHEDULED,
            Remarks: row.Remarks || reason
          },
          reason
        });
        continue;
      }

      const validationError = validateDemoScheduledRow(row);
      if (validationError) {
        plan.invalidRows.push({ row: failureRow(row, validationError), reason: validationError });
        continue;
      }

      plan.demoScheduledRows.push({ ...row, lead_status: LEAD_STATUS.DEMO_SCHEDULED });
      if (row.email) plan.meetingRecipients.push(String(row.email));
      continue;
    }

    if (normalized === LEAD_STATUS.RESCHEDULE) {
      const validationError = validateDemoScheduledRow(row);
      if (validationError) {
        plan.invalidRows.push({ row: failureRow(row, validationError), reason: validationError });
        continue;
      }

      plan.rescheduleRows.push({ ...row, lead_status: LEAD_STATUS.RESCHEDULE });
      if (row.email) plan.meetingRecipients.push(String(row.email));
      continue;
    }

    if (normalized === LEAD_STATUS.DEMO_DONE) {
      const validationError = validateDemoDoneRow(row);
      if (validationError) {
        plan.invalidRows.push({ row: failureRow(row, validationError), reason: validationError });
        continue;
      }

      plan.demoDoneRows.push({ ...row, lead_status: LEAD_STATUS.DEMO_DONE });
      if (row.email) plan.thankYouRecipients.push(String(row.email));
      continue;
    }

    if (STATUS_ONLY_VALUES.has(normalized)) {
      plan.statusOnlyRows.push({
        ...row,
        lead_status: normalized,
        Remarks: row.Remarks || ''
      });
      if (normalized === LEAD_STATUS.NO_RESPONSE && row.email) {
        plan.noResponseRecipients.push(String(row.email));
      }
      continue;
    }

    plan.invalidRows.push({
      row: failureRow(row, 'Unsupported lead_status value.'),
      reason: 'Unsupported lead_status value.'
    });
  }

  plan.summary.demoScheduled = plan.demoScheduledRows.length;
  plan.summary.reschedule = plan.rescheduleRows.length;
  plan.summary.demoDone = plan.demoDoneRows.length;
  plan.summary.noResponse = plan.statusOnlyRows.filter(
    (row) => normalizeLeadStatus(row.lead_status) === LEAD_STATUS.NO_RESPONSE
  ).length;
  plan.summary.statusOnly = plan.statusOnlyRows.length - plan.summary.noResponse;
  plan.summary.invalid = plan.invalidRows.length;
  plan.summary.skipped = plan.skippedRows.length;
  plan.summary.actionable =
    plan.summary.demoScheduled +
    plan.summary.reschedule +
    plan.summary.demoDone +
    plan.summary.noResponse +
    plan.summary.statusOnly;
  plan.estimatedTime = estimateProcessingTime(
    plan.summary.demoScheduled + plan.summary.reschedule,
    plan.summary.demoDone,
    plan.summary.noResponse + plan.summary.statusOnly
  );

  return plan;
}

export async function processLeadsByStatus(
  rows: ExcelRow[],
  context: SheetContext
): Promise<ProcessLeadsResult> {
  await assertProcessBatchLifecycleOwnership(rows, context.emailBrand, senderAccountKeyForContext(context));
  const plan = await buildProcessLeadPlan(rows);
  const resultsById = new Map<string, ExcelRow>();
  const sheetUpdates: GoogleSheetRowUpdate[] = [];
  let sheetSyncError: string | undefined;
  const summary: ProcessLeadsResult['summary'] = {
    total: rows.length,
    demoScheduled: 0,
    reschedule: 0,
    demoDone: 0,
    noResponse: 0,
    statusOnly: 0,
    invalid: plan.invalidRows.length,
    failed: plan.invalidRows.length,
    skipped: plan.skippedRows.length,
    timeConflicts: plan.summary.timeConflicts
  };
  const assertStillCurrent = async () => {
    await context.assertStillCurrent?.();
  };
  const notifyRowProcessed = async (row: ExcelRow) => {
    await assertStillCurrent();
    await context.onRowProcessed?.(row, summary);
  };

  for (const item of plan.invalidRows) {
    await assertStillCurrent();
    resultsById.set(item.row.id, item.row);
    collectSheetUpdate(sheetUpdates, item.row, {
      lead_status: item.row.lead_status || '',
      Remarks: item.row.Remarks || item.reason || ''
    });
    await notifyRowProcessed(item.row);
  }

  for (const item of plan.skippedRows) {
    await assertStillCurrent();
    resultsById.set(item.row.id, item.row);
    collectSheetUpdate(sheetUpdates, item.row, {
      'Meeting Details': item.row['Meeting Details'] || '',
      lead_status: item.row.lead_status || '',
      Remarks: item.row.Remarks || item.reason || ''
    });
    await notifyRowProcessed(item.row);
  }

  for (let index = 0; index < plan.demoScheduledRows.length; index++) {
    const row = plan.demoScheduledRows[index];
    await assertStillCurrent();
    try {
      const { rows: processedRows, summary: rowSummary } = await processScheduleRows([row], {
        sheetContext: context
      });
      const processedRow = processedRows[0] || row;
      resultsById.set(row.id, processedRow);
      summary.demoScheduled += rowSummary.scheduled;
      summary.failed += rowSummary.failed;
      summary.skipped += rowSummary.skipped;
      collectSheetUpdate(sheetUpdates, processedRow, {
        'Meeting Details': processedRow['Meeting Details'] || '',
        lead_status: processedRow.lead_status || LEAD_STATUS.DEMO_SCHEDULED,
        Remarks: processedRow.Remarks || ''
      });
      await assertStillCurrent();
      await saveSheetLeadState(processedRow, { lastAction: 'DEMO_SCHEDULED', lastActionStatus: 'success' }, context.emailBrand);
      await notifyRowProcessed(processedRow);
    } catch (err: unknown) {
      if (isStaleWorkflowGenerationError(err)) throw err;
      const message = err instanceof Error ? err.message : 'Scheduling failed.';
      const failedRow = failureRow(row, message);
      resultsById.set(row.id, failedRow);
      summary.failed++;
      collectSheetUpdate(sheetUpdates, failedRow, {
        lead_status: failedRow.lead_status || LEAD_STATUS.DEMO_SCHEDULED,
        Remarks: message
      });
      await assertStillCurrent();
      await saveSheetLeadState(failedRow, { lastAction: 'DEMO_SCHEDULED', lastActionStatus: 'failed', lastError: message }, context.emailBrand);
      await notifyRowProcessed(failedRow);
    }

    if (index < plan.demoScheduledRows.length - 1 || plan.demoDoneRows.length > 0) {
      await delay(PROCESS_DELAY_MS);
    }
  }

  for (let index = 0; index < plan.rescheduleRows.length; index++) {
    const row = plan.rescheduleRows[index];
    await assertStillCurrent();
    const currentMeetingDate = normalizeLeadDate(row['Date of Demo']);
    const currentMeetingTime = normalizeLeadTime(row['Time of Demo']);
    try {
      const sheetState = await getSheetLeadState(row, context.emailBrand);
      const sameMeetingAsLastReschedule =
        normalizeLeadStatus(row.lead_status) === LEAD_STATUS.RESCHEDULE &&
        sheetState?.lastLeadStatus === LEAD_STATUS.RESCHEDULE &&
        (sheetState?.lastAction === RESCHEDULE_ACTION ||
          sheetState?.lastAction === EMAIL_LOG_TYPES.DEMO_RESCHEDULED) &&
        sheetState.lastActionStatus === 'success' &&
        sheetState.lastMeetingDate === currentMeetingDate &&
        sheetState.lastMeetingTime === currentMeetingTime;

      if (sameMeetingAsLastReschedule) {
        const skippedRow: ExcelRow = {
          ...row,
          'Meeting Details': sheetState.lastMeetingLink || row['Meeting Details'] || '',
          lead_status: LEAD_STATUS.DEMO_SCHEDULED,
          Remarks: 'This reschedule was already processed'
        };
        resultsById.set(row.id, skippedRow);
        summary.skipped++;
        collectSheetUpdate(sheetUpdates, skippedRow, {
          'Meeting Details': skippedRow['Meeting Details'] || '',
          lead_status: LEAD_STATUS.DEMO_SCHEDULED,
          Remarks: skippedRow.Remarks || ''
        });
        await notifyRowProcessed(skippedRow);
        continue;
      }

      const result = await rescheduleDemoForRow(row, context, { skipSheetSync: true });
      const processedRow = result.row;
      resultsById.set(row.id, processedRow);
      if (result.skipped) summary.skipped++;
      else summary.reschedule++;
      collectSheetUpdate(sheetUpdates, processedRow, {
        'Meeting Details': processedRow['Meeting Details'] || '',
        lead_status: LEAD_STATUS.DEMO_SCHEDULED,
        Remarks: processedRow.Remarks || ''
      });
      await assertStillCurrent();
      await saveSheetLeadState(processedRow, {
        lastLeadStatus: LEAD_STATUS.RESCHEDULE,
        lastMeetingDate: currentMeetingDate || null,
        lastMeetingTime: currentMeetingTime || null,
        lastMeetingLink: String(processedRow['Meeting Details'] || '') || null,
        lastAction: RESCHEDULE_ACTION,
        lastActionStatus: result.skipped ? 'skipped' : 'success',
        lastError: null
      }, context.emailBrand);
      await notifyRowProcessed(processedRow);
    } catch (err: unknown) {
      if (isStaleWorkflowGenerationError(err)) throw err;
      const message = err instanceof Error ? err.message : 'Reschedule failed.';
      const failedRow = failureRow(row, message);
      resultsById.set(row.id, failedRow);
      summary.failed++;
      collectSheetUpdate(sheetUpdates, failedRow, {
        lead_status: LEAD_STATUS.RESCHEDULE,
        Remarks: message
      });
      await assertStillCurrent();
      await saveSheetLeadState(failedRow, {
        lastLeadStatus: LEAD_STATUS.RESCHEDULE,
        lastMeetingDate: currentMeetingDate || null,
        lastMeetingTime: currentMeetingTime || null,
        lastMeetingLink: String(row['Meeting Details'] || '') || null,
        lastAction: RESCHEDULE_ACTION,
        lastActionStatus: 'failed',
        lastError: message
      }, context.emailBrand);
      await notifyRowProcessed(failedRow);
    }

    if (index < plan.rescheduleRows.length - 1 || plan.demoDoneRows.length > 0) {
      await delay(PROCESS_DELAY_MS);
    }
  }

  for (let index = 0; index < plan.demoDoneRows.length; index++) {
    const row = plan.demoDoneRows[index];
    await assertStillCurrent();
    try {
      const result = await sendThankYouForRow(row, context, { skipSheetSync: true });
      resultsById.set(row.id, result.row);
      if (result.skipped) summary.skipped++;
      else summary.demoDone++;
      collectSheetUpdate(sheetUpdates, result.row, {
        'Meeting Details': '',
        lead_status: result.row.lead_status || LEAD_STATUS.DEMO_DONE,
        Remarks: result.row.Remarks || result.message || ''
      });
      await assertStillCurrent();
      await saveSheetLeadState(result.row, {
        lastMeetingLink: null,
        lastAction: 'DEMO_DONE_THANK_YOU',
        lastActionStatus: result.skipped ? 'skipped' : 'success'
      }, context.emailBrand);
      await notifyRowProcessed(result.row);
    } catch (err: unknown) {
      if (isStaleWorkflowGenerationError(err)) throw err;
      const message = err instanceof Error ? err.message : 'Thank-you email failed.';
      const failedRow = failureRow(row, message);
      resultsById.set(row.id, failedRow);
      summary.failed++;
      collectSheetUpdate(sheetUpdates, failedRow, {
        lead_status: failedRow.lead_status || LEAD_STATUS.DEMO_DONE,
        Remarks: message
      });
      await assertStillCurrent();
      await saveSheetLeadState(failedRow, { lastAction: 'DEMO_DONE_THANK_YOU', lastActionStatus: 'failed', lastError: message }, context.emailBrand);
      await notifyRowProcessed(failedRow);
    }

    if (index < plan.demoDoneRows.length - 1) {
      await delay(PROCESS_DELAY_MS);
    }
  }

  for (const row of plan.statusOnlyRows) {
    await assertStillCurrent();
    try {
      const isNoResponse = normalizeLeadStatus(row.lead_status) === LEAD_STATUS.NO_RESPONSE;
      const result =
        isNoResponse
          ? await sendNoResponseForRow(row, context, { skipSheetSync: true })
          : {
              row: await updateLeadStatusOnly(
                row,
                String(row.lead_status || ''),
                context,
                row.Remarks,
                { skipSheetSync: true }
              ),
              skipped: false
            };
      const updatedRow = result.row;
      resultsById.set(row.id, updatedRow);
      if (isNoResponse) summary.noResponse++;
      else summary.statusOnly++;
      collectSheetUpdate(sheetUpdates, updatedRow, {
        'Meeting Details': updatedRow['Meeting Details'] || '',
        lead_status: updatedRow.lead_status || '',
        Remarks: updatedRow.Remarks || ''
      });
      await assertStillCurrent();
      await saveSheetLeadState(updatedRow, {
        lastMeetingLink: String(updatedRow['Meeting Details'] || '') || null,
        lastAction: isNoResponse ? 'NO_RESPONSE' : 'STATUS_ONLY',
        lastActionStatus: result.skipped ? 'skipped' : 'success'
      }, context.emailBrand);
      await notifyRowProcessed(updatedRow);
    } catch (err: unknown) {
      if (isStaleWorkflowGenerationError(err)) throw err;
      const message = err instanceof Error ? err.message : 'Status update failed.';
      const failedRow = failureRow(row, message);
      resultsById.set(row.id, failedRow);
      summary.failed++;
      collectSheetUpdate(sheetUpdates, failedRow, {
        lead_status: failedRow.lead_status || '',
        Remarks: message
      });
      await assertStillCurrent();
      await saveSheetLeadState(failedRow, { lastAction: 'STATUS_ONLY', lastActionStatus: 'failed', lastError: message }, context.emailBrand);
      await notifyRowProcessed(failedRow);
    }
  }

  if (
    context.sourceType === 'google-sheet' &&
    context.spreadsheetId &&
    context.sheetName &&
    context.headers?.length
  ) {
    await assertStillCurrent();
    try {
      const sheetResults = await updateGoogleSheetRowsResilient(
        context.spreadsheetId,
        context.sheetName,
        context.headers,
        sheetUpdates,
        {},
        googleSheetAccessForContext(context)
      );

      const failedResults = sheetResults.filter((result) => !result.success);
      for (const result of sheetResults) {
        if (result.success) {
          if (result.emailDeliveryId) {
            await assertStillCurrent();
            await markEmailSheetSyncSucceeded(result.emailDeliveryId);
          }
          continue;
        }

        await assertStillCurrent();
        await enqueueSheetSyncJob({
          spreadsheetId: context.spreadsheetId,
          sheetName: context.sheetName,
          rowNumber: result.rowNumber,
          headers: context.headers,
          values: result.values,
          emailDeliveryId: result.emailDeliveryId,
          dataSourceId: result.dataSourceId,
          sourceTabId: result.sourceTabId,
          sourceRowId: result.sourceRowId,
          workspaceKey: context.workspaceKey,
          emailBrand: context.emailBrand,
          googleAccountKey: context.googleAccountKey,
          error: result.error
        });
        if (result.emailDeliveryId) {
          await assertStillCurrent();
          await markEmailSheetSyncFailed(result.emailDeliveryId, result.error);
        }
      }

      if (failedResults.length > 0) {
        sheetSyncError = `${failedResults.length} Google Sheet row update(s) queued for retry.`;
      }
    } catch (err) {
      if (isStaleWorkflowGenerationError(err)) throw err;
      const friendly = friendlySheetsError(err);
      sheetSyncError = friendly.message;
      console.error('GOOGLE_SHEET_SYNC_AFTER_PROCESS_FAILED', {
        spreadsheetId: context.spreadsheetId,
        sheetName: context.sheetName,
        status: friendly.status,
        message: friendly.message
      });
    }
  }

  return {
    rows: rows.map((row) => resultsById.get(row.id) || row),
    sheetSyncError,
    summary: {
      ...summary,
      invalid: summary.failed
    },
    groups: {
      demoScheduledRows: plan.demoScheduledRows,
      rescheduleRows: plan.rescheduleRows,
      demoDoneRows: plan.demoDoneRows,
      statusOnlyRows: plan.statusOnlyRows,
      invalidRows: flattenPlannedRows(plan.invalidRows),
      skippedRows: flattenPlannedRows(plan.skippedRows)
    }
  };
}

export async function syncSheetRow(
  row: ExcelRow,
  context: SheetContext,
  updates: Record<string, string>,
  includeMeetingDetails = false
) {
  if (context.sourceType !== 'google-sheet') return;
  if (!context.spreadsheetId || !context.sheetName || !context.headers?.length) return;

  const sheetRowNumber = Number(row.__sheetRowNumber || row.__sourceRowNumber);
  if (!sheetRowNumber || sheetRowNumber < 2) return;

  const payload: Record<string, string> = {
    lead_status: updates.lead_status ?? '',
    Remarks: updates.Remarks ?? ''
  };

  if (includeMeetingDetails && updates['Meeting Details'] !== undefined) {
    payload['Meeting Details'] = updates['Meeting Details'];
  }

  await assertWorkflowStillValid(context);
  await updateGoogleSheetRow(
    context.spreadsheetId,
    context.sheetName,
    sheetRowNumber,
    context.headers,
    payload,
    googleSheetAccessForContext(context)
  );
}

export async function sendThankYouForRow(
  row: ExcelRow,
  context: SheetContext,
  options: WorkflowOptions = {}
) {
  const email = String(row.email || '').trim();
  if (!email) throw new Error('Email is missing.');
  if (!isValidEmail(email)) throw new Error('Email is invalid.');
  await assertWorkflowStillValid(context);
  const active = await assertManualCloseAllowed(row, context);
  const sessionId = String(active.state.activeDemoSessionId || active.history?.sessionId || '').trim();
  if (!sessionId) throw new Error('Active demo session ID is missing.');
  const ownerBrand = active.emailBrand;
  const ownerContext = contextForOwnerBrand(
    context,
    ownerBrand,
    active.senderAccountKey
  );
  const ownerRow: ExcelRow = {
    ...row,
    __emailBrand: ownerBrand,
    __senderAccountKey: senderAccountKeyForContext(ownerContext),
    __demoSessionId: sessionId,
    'Date of Demo': active.history?.displayDate || active.state.demoDate || row['Date of Demo'],
    'Time of Demo': active.history?.displayTime || active.state.demoTime || row['Time of Demo'],
    'Meeting Details': active.state.meetingLink || row['Meeting Details'] || ''
  };

  const template = buildThankYouEmail({ fullName: ownerRow.full_name, brand: emailBrandKeyForContext(ownerContext) });
  const recipient = email.toLowerCase();
  const automationId = getAutomationId(ownerRow, ownerContext);
  const eventKey = createEmailEventKey({
    automationId,
    recipient,
    emailType: EMAIL_TYPES.DEMO_DONE,
    sessionId
  });
  const payloadHash = createEmailPayloadHash({
    recipient,
    subject: template.subject,
    text: template.text,
    html: template.html
  });

  await assertWorkflowStillValid(ownerContext);
  const intent = await createPendingEmailDeliveryIntent({
    eventKey,
    automationId,
    demoSessionId: sessionId,
    emailType: EMAIL_TYPES.DEMO_DONE,
    recipient,
    emailBrand: ownerBrand,
    senderAccountKey: senderAccountKeyForContext(ownerContext),
    payloadHash,
    subject: template.subject,
    text: template.text,
    html: template.html
  });

  await assertWorkflowStillValid(ownerContext);
  await closeActiveDemoForRow(ownerRow, LEAD_STATUS.DEMO_DONE, ownerBrand, {
    senderAccountKey: senderAccountKeyForContext(ownerContext)
  });

  const emailResult = await sendPendingOutcomeEmail({
    context: ownerContext,
    deliveryId: intent.deliveryId,
    sessionId,
    recipient,
    status: LEAD_STATUS.DEMO_DONE,
    send: () =>
      sendThankYouEmail({
        row: ownerRow,
        senderAccountKey: senderAccountKeyForContext(ownerContext),
        emailBrandKey: emailBrandKeyForContext(ownerContext)
      })
  });

  const updatedRow: ExcelRow = {
    ...ownerRow,
    __emailBrand: ownerBrand,
    __senderAccountKey: senderAccountKeyForContext(ownerContext),
    __demoSessionId: sessionId,
    'Meeting Details': '',
    lead_status: LEAD_STATUS.DEMO_DONE,
    Remarks: emailResult.message,
    __emailDeliveryId: intent.deliveryId
  };

  if (!options.skipSheetSync) {
    await syncSheetRow(updatedRow, ownerContext, {
      'Meeting Details': '',
      lead_status: LEAD_STATUS.DEMO_DONE,
      Remarks: updatedRow.Remarks || ''
    }, true);
  }

  return { row: updatedRow, skipped: false, message: emailResult.message };
}

export async function sendNoResponseForRow(
  row: ExcelRow,
  context: SheetContext,
  options: WorkflowOptions = {}
) {
  const email = String(row.email || '').trim();
  if (!email) throw new Error('Email is missing.');
  if (!isValidEmail(email)) throw new Error('Email is invalid.');
  await assertWorkflowStillValid(context);
  const active = await assertManualCloseAllowed(row, context);
  const sessionId = String(active.state.activeDemoSessionId || active.history?.sessionId || '').trim();
  if (!sessionId) throw new Error('Active demo session ID is missing.');
  const ownerBrand = active.emailBrand;
  const ownerContext = contextForOwnerBrand(
    context,
    ownerBrand,
    active.senderAccountKey
  );
  const ownerRow: ExcelRow = {
    ...row,
    __emailBrand: ownerBrand,
    __senderAccountKey: senderAccountKeyForContext(ownerContext),
    __demoSessionId: sessionId,
    'Date of Demo': active.history?.displayDate || active.state.demoDate || row['Date of Demo'],
    'Time of Demo': active.history?.displayTime || active.state.demoTime || row['Time of Demo'],
    'Meeting Details': active.state.meetingLink || row['Meeting Details'] || ''
  };

  const template = buildNoResponseEmail({ fullName: ownerRow.full_name, brand: emailBrandKeyForContext(ownerContext) });
  const recipient = email.toLowerCase();
  const automationId = getAutomationId(ownerRow, ownerContext);
  const eventKey = createEmailEventKey({
    automationId,
    recipient,
    emailType: EMAIL_TYPES.NO_RESPONSE,
    sessionId
  });
  const payloadHash = createEmailPayloadHash({
    recipient,
    subject: template.subject,
    text: template.text,
    html: template.html
  });

  await assertWorkflowStillValid(ownerContext);
  const intent = await createPendingEmailDeliveryIntent({
    eventKey,
    automationId,
    demoSessionId: sessionId,
    emailType: EMAIL_TYPES.NO_RESPONSE,
    recipient,
    emailBrand: ownerBrand,
    senderAccountKey: senderAccountKeyForContext(ownerContext),
    payloadHash,
    subject: template.subject,
    text: template.text,
    html: template.html
  });

  await assertWorkflowStillValid(ownerContext);
  await closeActiveDemoForRow(ownerRow, LEAD_STATUS.NO_RESPONSE, ownerBrand, {
    senderAccountKey: senderAccountKeyForContext(ownerContext)
  });

  const emailResult = await sendPendingOutcomeEmail({
    context: ownerContext,
    deliveryId: intent.deliveryId,
    sessionId,
    recipient,
    status: LEAD_STATUS.NO_RESPONSE,
    send: () =>
      sendNoResponseEmail({
        row: ownerRow,
        senderAccountKey: senderAccountKeyForContext(ownerContext),
        emailBrandKey: emailBrandKeyForContext(ownerContext)
      })
  });

  const updatedRow: ExcelRow = {
    ...ownerRow,
    __emailBrand: ownerBrand,
    __senderAccountKey: senderAccountKeyForContext(ownerContext),
    __demoSessionId: sessionId,
    lead_status: LEAD_STATUS.NO_RESPONSE,
    'Meeting Details': '',
    Remarks: emailResult.message,
    __emailDeliveryId: intent.deliveryId
  };

  if (!options.skipSheetSync) {
    await syncSheetRow(updatedRow, ownerContext, {
      'Meeting Details': '',
      lead_status: LEAD_STATUS.NO_RESPONSE,
      Remarks: updatedRow.Remarks || ''
    }, true);
  }

  return { row: updatedRow, skipped: false, message: emailResult.message };
}

export async function rescheduleDemoForRow(
  row: ExcelRow,
  context: SheetContext,
  options: WorkflowOptions = {}
) {
  const email = String(row.email || '').trim();
  if (!email) throw new Error('Email is missing.');
  if (!isValidEmail(email)) throw new Error('Email is invalid.');

  const active = await assertDemoLifecycleOwnership(row, context.emailBrand, senderAccountKeyForContext(context));
  const ownerBrand = active.emailBrand;
  const ownerContext = contextForOwnerBrand(
    context,
    ownerBrand,
    active.senderAccountKey
  );
  if (!active.history) throw new Error('Active demo history record was not found.');
  if (!active.state.meetingLink || !active.state.calendarEventId) {
    throw new Error('An active meeting is required to reschedule.');
  }
  if (active.history.status !== LEAD_STATUS.DEMO_SCHEDULED) {
    throw new Error('Only a scheduled active demo can be rescheduled.');
  }

  const oldDate = active.state.demoDate || active.history.displayDate || undefined;
  const oldTime = active.state.demoTime || active.history.displayTime || undefined;
  await assertWorkflowStillValid(ownerContext);
  const calendarResult = await updateCalendarMeeting(
    row,
    active.state.calendarEventId,
    senderAccountKeyForContext(ownerContext),
    emailBrandKeyForContext(ownerContext)
  );
  const meetLink = calendarResult.meetLink || active.state.meetingLink;
  const calendarEventId = calendarResult.eventId || active.state.calendarEventId;

  const updatedRow: ExcelRow = {
    ...row,
    __emailBrand: ownerBrand,
    __senderAccountKey: senderAccountKeyForContext(ownerContext),
    'Meeting Details': meetLink,
    lead_status: LEAD_STATUS.DEMO_SCHEDULED,
    Remarks: 'Rescheduled. Meeting updated and email sent.'
  };

  await assertWorkflowStillValid(ownerContext);
  await rescheduleActiveDemoForRow(updatedRow, {
    meetingLink: meetLink,
    calendarEventId
  }, ownerBrand, senderAccountKeyForContext(ownerContext));

  await assertWorkflowStillValid(ownerContext);
  await saveLeadScheduleSuccess(
    updatedRow,
    {
      meetingLink: meetLink,
      calendarEventId,
      remarks: 'Rescheduled. Email pending.',
      status: LEAD_STATUS.DEMO_SCHEDULED
    },
    {
      sourceType: ownerContext.sourceType || row.__sourceType,
      sourceId: ownerContext.spreadsheetId || row.__spreadsheetId,
      emailBrand: ownerBrand,
      senderAccountKey: senderAccountKeyForContext(ownerContext)
    }
  );

  await assertWorkflowStillValid(ownerContext);
  invalidateScheduledReminder(row, 'Reminder invalidated by reschedule');
  addScheduledReminder(updatedRow, meetLink, calendarResult.startTime);

  const template = buildRescheduleEmail({
    fullName: row.full_name,
    date: String(row['Date of Demo'] || ''),
    time: String(row['Time of Demo'] || ''),
    meetLink,
    oldDate,
    oldTime,
    brand: emailBrandKeyForContext(ownerContext)
  });
  let emailResult: Awaited<ReturnType<typeof sendIdempotentEmail>> | null = null;
  let emailError = '';
  try {
    emailResult = await sendIdempotentEmail({
      row: updatedRow,
      context: ownerContext,
      emailType: EMAIL_TYPES.DEMO_RESCHEDULED,
      date: row['Date of Demo'],
      time: row['Time of Demo'],
      subject: template.subject,
      text: template.text,
      html: template.html,
      send: () =>
        sendGmailRescheduleInvite(updatedRow, meetLink, {
          date: oldDate,
          time: oldTime
        },
        senderAccountKeyForContext(ownerContext),
        emailBrandKeyForContext(ownerContext))
    });
  } catch (error) {
    if (isStaleWorkflowGenerationError(error)) throw error;
    emailError = error instanceof Error ? error.message : String(error);
  }

  const remarks = emailError
    ? `Rescheduled. Meeting updated, but email failed: ${emailError}`
    : emailResult?.sent
      ? 'Rescheduled. Meeting updated and email sent.'
      : emailResult?.reason === 'ALREADY_SENT'
        ? 'Reschedule email already sent'
        : emailResult?.reason === 'ALREADY_PROCESSING'
          ? 'Reschedule email is being processed'
          : emailResult?.reason === 'UNKNOWN_RESULT'
            ? 'Reschedule email result requires review'
            : 'Reschedule email failed: review delivery status';

  const finalRow: ExcelRow = {
    ...updatedRow,
    __emailBrand: ownerBrand,
    __senderAccountKey: senderAccountKeyForContext(ownerContext),
    Remarks: remarks,
    __emailDeliveryId: emailResult?.deliveryId
  };

  await assertWorkflowStillValid(ownerContext);
  await saveLeadScheduleSuccess(
    finalRow,
    {
      meetingLink: meetLink,
      calendarEventId,
      gmailMessageId: emailResult?.messageId || undefined,
      remarks,
      status: LEAD_STATUS.DEMO_SCHEDULED
    },
    {
      sourceType: ownerContext.sourceType || row.__sourceType,
      sourceId: ownerContext.spreadsheetId || row.__spreadsheetId,
      emailBrand: ownerBrand,
      senderAccountKey: senderAccountKeyForContext(ownerContext)
    }
  );

  if (!options.skipSheetSync) {
    await syncSheetRow(row, ownerContext, {
      'Meeting Details': meetLink,
      lead_status: LEAD_STATUS.DEMO_SCHEDULED,
      Remarks: remarks
    }, true);
  }

  return {
    row: finalRow,
    skipped: !!emailResult?.skipped,
    message: remarks
  };
}

export async function updateLeadStatusOnly(
  row: ExcelRow,
  status: string,
  context: SheetContext,
  remarks?: string,
  options: WorkflowOptions = {}
) {
  const normalized = normalizeLeadStatus(status);
  if (!normalized) throw new Error('Invalid lead_status value.');

  const updatedRow: ExcelRow = {
    ...row,
    __emailBrand: context.emailBrand,
    __senderAccountKey: senderAccountKeyForContext(context),
    lead_status: normalized,
    Remarks: remarks ?? row.Remarks ?? ''
  };

  if (!options.skipSheetSync) {
    await syncSheetRow(row, context, {
      lead_status: normalized,
      Remarks: updatedRow.Remarks || ''
    });
  }

  await assertWorkflowStillValid(context);
  await saveLeadStatusUpdate(
    updatedRow,
    {
      status: normalized,
      remarks: updatedRow.Remarks || ''
    },
    {
      sourceType: context.sourceType,
      sourceId: context.spreadsheetId,
      emailBrand: context.emailBrand,
      senderAccountKey: senderAccountKeyForContext(context)
    }
  );

  return updatedRow;
}

export async function processScheduleRows(
  rows: ExcelRow[],
  options?: {
    onRowProcessed?: (row: ExcelRow, index: number) => Promise<void>;
    sheetContext?: SheetContext;
    forceNewSchedule?: boolean;
    emailLogType?: (typeof EMAIL_LOG_TYPES)[keyof typeof EMAIL_LOG_TYPES];
    successRemarks?: string;
    previousMeetingDate?: string | null;
    previousMeetingTime?: string | null;
  }
) {
  const results: ExcelRow[] = [];
  const summary: ScheduleSummary = {
    totalRows: rows.length,
    scheduled: 0,
    failed: 0,
    skipped: 0
  };
  const requiredEmailBrand = options?.sheetContext?.emailBrand;
  if (!requiredEmailBrand) {
    throw new Error('emailBrand is required for scheduling.');
  }
  const requiredSenderAccountKey = options.sheetContext?.senderAccountKey
    ? senderAccountKeyForContext(options.sheetContext)
    : undefined;
  if (!requiredSenderAccountKey) {
    throw new Error('senderAccountKey is required for scheduling.');
  }

  const timeConflictGroups = findTimeConflictGroups(rows);
  summary.timeConflicts = timeConflictGroups.reduce((total, group) => total + group.count, 0);
  const assertStillCurrent = () => assertWorkflowStillValid(options?.sheetContext);
  const notifyScheduleRowProcessed = async (row: ExcelRow, index: number) => {
    await assertStillCurrent();
    await options?.onRowProcessed?.(row, index);
  };

  const validateScheduleDateTime = (dateValue: unknown, timeValue: unknown) => {
    const startTime = parseExcelDateTime(dateValue, timeValue);
    if (startTime.getTime() <= Date.now()) {
      throw new Error('Meeting date/time is in the past. Choose a future Date of Demo and Time of Demo.');
    }
    return startTime;
  };

  for (let index = 0; index < rows.length; index++) {
    await assertStillCurrent();
    const row = rows[index];
    const rowEmail = row.email || 'missing-email';
    console.log(`Processing row ${index + 1}/${rows.length}: ${rowEmail}`);

    const logResult = (result: 'Scheduled' | 'Failed' | 'Skipped') => {
      console.log(`Result: ${result}`);
    };

    const forceNewSchedule = !!options?.forceNewSchedule;
    const existingMeetLink = !forceNewSchedule && hasGoogleMeetLink(row['Meeting Details'])
      ? String(row['Meeting Details'])
      : '';

    if (!isDemoScheduledStatus(row.lead_status)) {
      results.push(row);
      summary.skipped++;
      logResult('Skipped');
      await notifyScheduleRowProcessed(row, index);
      if (index < rows.length - 1) await delay(1000);
      continue;
    }

    if (!row.email || !isValidEmail(String(row.email))) {
      const updatedRow: ExcelRow = {
        ...row,
        __schedulerStatus: 'Failed',
        Remarks: 'Email is invalid. Add a valid recipient email before scheduling.'
      };
      await assertStillCurrent();
      await saveLeadScheduleFailure(updatedRow, updatedRow.Remarks || 'Email is invalid', {
        sourceType: options?.sheetContext?.sourceType || row.__sourceType,
        sourceId: options?.sheetContext?.spreadsheetId || row.__spreadsheetId,
        emailBrand: requiredEmailBrand,
        senderAccountKey: requiredSenderAccountKey
      });
      results.push(updatedRow);
      summary.failed++;
      logResult('Failed');
      await notifyScheduleRowProcessed(updatedRow, index);
      if (index < rows.length - 1) await delay(1000);
      continue;
    }

    try {
      validateScheduleDateTime(row['Date of Demo'], row['Time of Demo']);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Date or time is invalid.';
      const updatedRow: ExcelRow = { ...row, __schedulerStatus: 'Failed', Remarks: message };
      await assertStillCurrent();
      await saveLeadScheduleFailure(updatedRow, message, {
        sourceType: options?.sheetContext?.sourceType || row.__sourceType,
        sourceId: options?.sheetContext?.spreadsheetId || row.__spreadsheetId,
        emailBrand: requiredEmailBrand,
        senderAccountKey: requiredSenderAccountKey
      });
      results.push(updatedRow);
      summary.failed++;
      logResult('Failed');
      await notifyScheduleRowProcessed(updatedRow, index);
      if (index < rows.length - 1) await delay(1000);
      continue;
    }

    const sheetContext = options?.sheetContext;
    if (!sheetContext?.senderAccountKey) {
      throw new Error('senderAccountKey is required for scheduling.');
    }
    await assertStillCurrent();
    const eventState = await getEmailEventState({
      row,
      context: sheetContext,
      emailType: EMAIL_TYPES.DEMO_SCHEDULED,
      date: row['Date of Demo'],
      time: row['Time of Demo']
    });
    if (eventState.delivery?.status === 'SENT') {
      const dbLink = await findScheduledMeetLinkFromDb(row, sheetContext.emailBrand);
      const updatedRow: ExcelRow = {
        ...row,
        __emailBrand: sheetContext.emailBrand,
        __senderAccountKey: senderAccountKeyForContext(sheetContext),
        'Meeting Details': dbLink || row['Meeting Details'] || '',
        lead_status: LEAD_STATUS.DEMO_SCHEDULED,
        Remarks: 'Already sent, skipped duplicate'
      };
      console.log('EMAIL_DECISION', {
        decision: 'SKIP_ALREADY_SENT',
        eventKey: eventState.eventKey,
        automationId: eventState.automationId,
        recipient: maskEmail(String(row.email || '')),
        emailType: EMAIL_TYPES.DEMO_SCHEDULED
      });
      results.push(updatedRow);
      summary.skipped++;
      logResult('Skipped');
      await notifyScheduleRowProcessed(updatedRow, index);
      if (index < rows.length - 1) await delay(1000);
      continue;
    }

    if (eventState.delivery?.status === 'PROCESSING') {
      const updatedRow: ExcelRow = {
        ...row,
        __emailBrand: sheetContext.emailBrand,
        __senderAccountKey: senderAccountKeyForContext(sheetContext),
        lead_status: LEAD_STATUS.DEMO_SCHEDULED,
        Remarks: 'Email is being processed'
      };
      results.push(updatedRow);
      summary.skipped++;
      logResult('Skipped');
      await notifyScheduleRowProcessed(updatedRow, index);
      if (index < rows.length - 1) await delay(1000);
      continue;
    }

    if (eventState.delivery?.status === 'UNKNOWN') {
      const updatedRow: ExcelRow = {
        ...row,
        __emailBrand: sheetContext.emailBrand,
        __senderAccountKey: senderAccountKeyForContext(sheetContext),
        lead_status: LEAD_STATUS.DEMO_SCHEDULED,
        Remarks: 'Email result requires review'
      };
      results.push(updatedRow);
      summary.skipped++;
      logResult('Skipped');
      await notifyScheduleRowProcessed(updatedRow, index);
      if (index < rows.length - 1) await delay(1000);
      continue;
    }

    try {
      await assertStillCurrent();
      const activeDemo = await assertCanCreateOrReuseActiveDemo(row, sheetContext.emailBrand);
      let meetLink = existingMeetLink;
      let calendarEventId = activeDemo?.state.calendarEventId || '';
      let startTime = parseExcelDateTime(row['Date of Demo'], row['Time of Demo']).getTime();

      if (activeDemo?.state.meetingLink && activeDemo.state.calendarEventId) {
        meetLink = activeDemo.state.meetingLink;
        calendarEventId = activeDemo.state.calendarEventId;
        if (activeDemo.state.demoStartUtc) {
          const parsedStart = Date.parse(activeDemo.state.demoStartUtc);
          if (Number.isFinite(parsedStart)) startTime = parsedStart;
        }
        console.log('CALENDAR_EVENT_SKIPPED_ACTIVE_DEMO', {
          recipient: maskEmail(String(row.email || '')),
          emailType: EMAIL_TYPES.DEMO_SCHEDULED
        });
      } else if (hasGoogleMeetLink(meetLink)) {
        console.log('CALENDAR_EVENT_SKIPPED_EXISTING_MEET_LINK', {
          recipient: maskEmail(String(row.email || '')),
          emailType: EMAIL_TYPES.DEMO_SCHEDULED
        });
      } else {
        const dbLink = await findScheduledMeetLinkFromDb(row, sheetContext.emailBrand);
        if (hasGoogleMeetLink(dbLink)) {
          meetLink = dbLink;
          console.log('CALENDAR_EVENT_SKIPPED_DB_MEET_LINK', {
            recipient: maskEmail(String(row.email || '')),
            emailType: EMAIL_TYPES.DEMO_SCHEDULED
          });
        } else {
          if (isCalendarBlocked()) {
            throw new Error(calendarBlockedMessage());
          }

          await assertStillCurrent();
          const scheduleResult = await scheduleMeeting(
            row,
            senderAccountKeyForContext(sheetContext),
            emailBrandKeyForContext(sheetContext)
          );
          meetLink = scheduleResult.meetLink;
          calendarEventId = scheduleResult.eventId;
          startTime = scheduleResult.startTime;

          await assertStillCurrent();
          await saveLeadScheduleSuccess(
            { ...row, 'Meeting Details': meetLink },
            {
              meetingLink: meetLink,
              calendarEventId,
              remarks: 'Meeting link created; email pending',
              status: 'Email Pending'
            },
            {
              sourceType: options?.sheetContext?.sourceType || row.__sourceType,
              sourceId: options?.sheetContext?.spreadsheetId || row.__spreadsheetId,
              emailBrand: sheetContext.emailBrand,
              senderAccountKey: senderAccountKeyForContext(sheetContext)
            }
          );

          await assertStillCurrent();
          await ensureScheduledDemoHistory(
            { ...row, 'Meeting Details': meetLink },
            {
              meetingLink: meetLink,
              calendarEventId
            },
            {
              sourceType: options?.sheetContext?.sourceType || row.__sourceType,
              sourceId: options?.sheetContext?.spreadsheetId || row.__spreadsheetId,
              emailBrand: sheetContext.emailBrand,
              senderAccountKey: senderAccountKeyForContext(sheetContext)
            }
          );
        }
      }

      if (!calendarEventId) {
        throw new Error('An active Google Calendar event is required for Demo Scheduled.');
      }

      const isRescheduleEmail = options?.emailLogType === EMAIL_LOG_TYPES.DEMO_RESCHEDULED;
      const template = isRescheduleEmail
        ? buildRescheduleEmail({
            fullName: row.full_name,
            date: String(row['Date of Demo'] || ''),
            time: String(row['Time of Demo'] || ''),
            meetLink,
            oldDate: options?.previousMeetingDate || undefined,
            oldTime: options?.previousMeetingTime || undefined,
            brand: emailBrandKeyForContext(sheetContext)
          })
        : buildMeetingInviteEmail({
            fullName: row.full_name,
            date: String(row['Date of Demo'] || ''),
            time: String(row['Time of Demo'] || ''),
            meetLink,
            brand: emailBrandKeyForContext(sheetContext)
          });
      const emailResult = await sendIdempotentEmail({
        row,
        context: sheetContext,
        emailType: EMAIL_TYPES.DEMO_SCHEDULED,
        date: row['Date of Demo'],
        time: row['Time of Demo'],
        subject: template.subject,
        text: template.text,
        html: template.html,
        send: () =>
          isRescheduleEmail
            ? sendGmailRescheduleInvite(
                row,
                meetLink,
                {
                  date: options?.previousMeetingDate || undefined,
                  time: options?.previousMeetingTime || undefined
                },
                senderAccountKeyForContext(sheetContext),
                emailBrandKeyForContext(sheetContext)
              )
            : sendGmailInvite({
                row,
                meetLink,
                senderAccountKey: senderAccountKeyForContext(sheetContext),
                emailBrandKey: emailBrandKeyForContext(sheetContext)
              })
      });
      const gmailMessageId = emailResult.messageId || '';
      const remarks = emailResult.sent
        ? options?.successRemarks || 'Meeting scheduled and email sent'
        : emailResult.reason === 'ALREADY_SENT'
          ? 'Already sent, skipped duplicate'
          : emailResult.reason === 'ALREADY_PROCESSING'
            ? 'Email is being processed'
            : emailResult.reason === 'UNKNOWN_RESULT'
              ? 'Email result requires review'
              : 'Email failed: review delivery status';

      const updatedRow: ExcelRow = {
        ...row,
        __emailBrand: sheetContext.emailBrand,
        __senderAccountKey: senderAccountKeyForContext(sheetContext),
        'Meeting Details': meetLink,
        lead_status: LEAD_STATUS.DEMO_SCHEDULED,
        Remarks: remarks,
        __emailDeliveryId: emailResult.deliveryId
      };

      await assertStillCurrent();
      await saveLeadScheduleSuccess(
        updatedRow,
        {
          meetingLink: meetLink,
          calendarEventId: calendarEventId || undefined,
          gmailMessageId,
          remarks,
          status: LEAD_STATUS.DEMO_SCHEDULED
        },
        {
          sourceType: options?.sheetContext?.sourceType || row.__sourceType,
          sourceId: options?.sheetContext?.spreadsheetId || row.__spreadsheetId,
          emailBrand: sheetContext.emailBrand,
          senderAccountKey: senderAccountKeyForContext(sheetContext)
        }
      );

      await assertStillCurrent();
      await ensureScheduledDemoHistory(
        updatedRow,
        {
          meetingLink: meetLink,
          calendarEventId,
          scheduledEmailSentAt: emailResult.sent ? new Date().toISOString() : undefined
        },
        {
          sourceType: options?.sheetContext?.sourceType || row.__sourceType,
          sourceId: options?.sheetContext?.spreadsheetId || row.__spreadsheetId,
          emailBrand: sheetContext.emailBrand,
          senderAccountKey: senderAccountKeyForContext(sheetContext)
        }
      );
      if (emailResult.sent) {
        await assertStillCurrent();
        await markScheduledEmailSent(updatedRow, sheetContext.emailBrand);
      }

      await assertStillCurrent();
      addScheduledReminder(updatedRow, meetLink, startTime);
      results.push(updatedRow);
      summary.scheduled++;
      logResult('Scheduled');
      await notifyScheduleRowProcessed(updatedRow, index);
    } catch (err: unknown) {
      if (isStaleWorkflowGenerationError(err)) throw err;
      const failureMessage =
        err instanceof Error ? err.message : 'Scheduling failed: Google API transaction did not complete.';
      if (isCalendarQuotaBlocked(failureMessage)) {
        markCalendarBlocked();
      }
      const dbLink = await findScheduledMeetLinkFromDb(row, requiredEmailBrand);
      const preservedMeetLink = existingMeetLink || dbLink || String(row['Meeting Details'] || '');
      const updatedRow: ExcelRow = {
        ...row,
        'Meeting Details': preservedMeetLink,
        __schedulerStatus: 'Failed',
        Remarks: failureMessage
      };
      await assertStillCurrent();
      await saveLeadScheduleFailure(updatedRow, failureMessage, {
        sourceType: options?.sheetContext?.sourceType || row.__sourceType,
        sourceId: options?.sheetContext?.spreadsheetId || row.__spreadsheetId,
        emailBrand: requiredEmailBrand,
        senderAccountKey: requiredSenderAccountKey,
        status: scheduleFailureStatus(failureMessage),
        meetingLink: preservedMeetLink
      });
      results.push(updatedRow);
      summary.failed++;
      logResult('Failed');
      await notifyScheduleRowProcessed(updatedRow, index);
    }

    if (index < rows.length - 1) await delay(1000);
  }

  return { rows: results, summary };
}
