import { createHash, randomUUID } from 'node:crypto';
import type { ExcelRow } from '../src/types';
import { normalizeDisplayDate } from '../src/lib/dateFormat';

export const EMAIL_TYPES = {
  DEMO_SCHEDULED: 'DEMO_SCHEDULED',
  DEMO_RESCHEDULED: 'DEMO_RESCHEDULED',
  DEMO_DONE: 'DEMO_DONE',
  NO_RESPONSE: 'NO_RESPONSE',
  REMINDER: 'REMINDER'
} as const;

export type EmailType = (typeof EMAIL_TYPES)[keyof typeof EMAIL_TYPES];

export type EmailIdentityContext = {
  sourceType: 'excel' | 'google-sheet';
  spreadsheetId?: string;
  sheetName?: string;
};

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function clean(value: unknown) {
  return String(value ?? '').trim();
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function normalizeIdentityDate(value: unknown) {
  return normalizeDisplayDate(value);
}

export function normalizeIdentityTime(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const minutes = Math.round(value * 24 * 60);
    return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
  }

  const raw = clean(value);
  if (!raw) return '';

  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/i);
  if (!match) return raw.toLowerCase().replace(/\s+/g, ' ');

  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const suffix = match[3]?.toLowerCase();

  if (suffix === 'pm' && hours < 12) hours += 12;
  if (suffix === 'am' && hours === 12) hours = 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return raw.toLowerCase().replace(/\s+/g, ' ');
  }

  return `${pad(hours)}:${pad(minutes)}`;
}

export function createNewAutomationId() {
  return `lead_${randomUUID()}`;
}

export class MissingPermanentAutomationIdError extends Error {
  code = 'MISSING_PERMANENT_AUTOMATION_ID';
  statusCode = 400;

  constructor(message = 'Permanent automation_id is required before workflow email identity can be created.') {
    super(message);
    this.name = 'MissingPermanentAutomationIdError';
  }
}

export function getAutomationId(row: ExcelRow, context: EmailIdentityContext) {
  const existing = clean((row as ExcelRow & { automation_id?: string }).automation_id);
  if (existing) return existing;
  throw new MissingPermanentAutomationIdError();
}

export function createEmailEventKey(input: {
  automationId: string;
  recipient?: string;
  emailType: EmailType;
  sessionId?: unknown;
  date?: unknown;
  time?: unknown;
  reminderWindow?: string;
}) {
  const stableLeadKey = clean(input.automationId) || clean(input.recipient).toLowerCase();
  let version: string;

  if (input.emailType === EMAIL_TYPES.DEMO_DONE || input.emailType === EMAIL_TYPES.NO_RESPONSE) {
    version = clean(input.sessionId);
  } else {
    version = [
      normalizeIdentityDate(input.date),
      normalizeIdentityTime(input.time),
      clean(input.reminderWindow)
    ].filter(Boolean).join(':');
  }

  if (!version) {
    throw new Error(`Cannot create ${input.emailType} event key without event details.`);
  }

  return sha256([stableLeadKey, input.emailType, version].join('|'));
}

export function createEmailPayloadHash(input: {
  recipient: string;
  subject: string;
  text: string;
  html: string;
}) {
  return sha256([
    clean(input.recipient).toLowerCase(),
    input.subject,
    input.text,
    input.html
  ].join('|'));
}
