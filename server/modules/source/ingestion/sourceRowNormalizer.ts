import { getLeadStatusParse } from '../../../leadStatus';
import { normalizeDisplayDate, parseDateParts } from '../../../../src/lib/dateFormat';
import { createSourceRowHash } from './sourceRowHash';
import { buildSourceRowIdentity, markDuplicateAutomationIds } from './sourceRowIdentity';
import type {
  NormalizedReadRow,
  NormalizedSourceFields,
  ReadSourceTabResult,
  SourceValidationError
} from './sourceIngestion.types';

const HEADER_ALIASES: Record<keyof NormalizedSourceFields, string[]> = {
  fullName: ['full_name', 'full name', 'name', 'client name', 'lead name'],
  email: ['email', 'email address', 'mail', 'contact email'],
  leadStatus: ['lead_status', 'lead status', 'status'],
  demoDate: ['date of demo', 'demo date', 'date', 'meeting date'],
  demoTime: ['time of demo', 'demo time', 'time', 'meeting time'],
  meetingLink: ['meeting details', 'meeting link', 'meet link', 'google meet link'],
  remarks: ['remarks', 'notes', 'error'],
  automationId: ['automation_id', 'automation id', 'automationid']
};

function normalizeHeaderKey(header: string) {
  return String(header || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function stringValue(value: unknown) {
  return String(value ?? '').normalize('NFKC').trim();
}

function firstValueFor(headers: string[], values: unknown[], field: keyof NormalizedSourceFields) {
  const aliases = new Set(HEADER_ALIASES[field]);
  const index = headers.findIndex((header) => aliases.has(normalizeHeaderKey(header)));
  return index >= 0 ? stringValue(values[index]) : '';
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidTime(value: string) {
  if (!value) return true;
  return /^([01]?\d|2[0-3])(?::[0-5]\d)?(?::[0-5]\d)?\s*(am|pm)?$/i.test(value);
}

function validationStatus(errors: SourceValidationError[]) {
  if (errors.some((error) => error.severity === 'ERROR')) return 'INVALID' as const;
  if (errors.length > 0) return 'WARNING' as const;
  return 'VALID' as const;
}

function detectHeaderIssues(headers: string[]) {
  const errors: SourceValidationError[] = [];
  const seen = new Map<string, number>();

  headers.forEach((header, index) => {
    const key = normalizeHeaderKey(header);
    if (!key) {
      errors.push({
        code: 'EMPTY_HEADER',
        field: `headers[${index}]`,
        severity: 'WARNING',
        message: 'Header is empty.'
      });
      return;
    }

    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    if (count > 1) {
      errors.push({
        code: 'DUPLICATE_HEADER',
        field: header,
        severity: 'WARNING',
        message: `Header ${header} appears more than once.`
      });
    }
  });

  return errors;
}

function normalizeRow(tab: ReadSourceTabResult, row: { rowNumber: number; values: unknown[] }) {
  const headerErrors = detectHeaderIssues(tab.headers);
  const leadStatusParse = getLeadStatusParse(firstValueFor(tab.headers, row.values, 'leadStatus'));
  const email = normalizeEmail(firstValueFor(tab.headers, row.values, 'email'));
  const demoDateRaw = firstValueFor(tab.headers, row.values, 'demoDate');
  const demoTime = firstValueFor(tab.headers, row.values, 'demoTime');
  const errors: SourceValidationError[] = [...headerErrors];

  if (!email) {
    errors.push({
      code: 'MISSING_EMAIL',
      field: 'email',
      severity: 'ERROR',
      message: 'Email is missing.'
    });
  } else if (!isValidEmail(email)) {
    errors.push({
      code: 'INVALID_EMAIL',
      field: 'email',
      severity: 'ERROR',
      message: 'Email is invalid.'
    });
  }

  if (leadStatusParse.raw && !leadStatusParse.isKnown) {
    errors.push({
      code: 'UNKNOWN_LEAD_STATUS',
      field: 'leadStatus',
      severity: 'ERROR',
      message: `Unknown lead status: ${leadStatusParse.raw}`
    });
  }

  if (demoDateRaw && !parseDateParts(demoDateRaw)) {
    errors.push({
      code: 'INVALID_DATE',
      field: 'demoDate',
      severity: 'ERROR',
      message: 'Demo date is invalid.'
    });
  }

  if (!isValidTime(demoTime)) {
    errors.push({
      code: 'INVALID_TIME',
      field: 'demoTime',
      severity: 'ERROR',
      message: 'Demo time is invalid.'
    });
  }

  const normalizedFields: NormalizedSourceFields = {
    fullName: firstValueFor(tab.headers, row.values, 'fullName'),
    email,
    leadStatus: leadStatusParse.normalized || leadStatusParse.raw,
    demoDate: demoDateRaw ? normalizeDisplayDate(demoDateRaw) : '',
    demoTime,
    meetingLink: firstValueFor(tab.headers, row.values, 'meetingLink'),
    remarks: firstValueFor(tab.headers, row.values, 'remarks'),
    automationId: firstValueFor(tab.headers, row.values, 'automationId')
  };

  const identity = buildSourceRowIdentity(normalizedFields.automationId, row.rowNumber);
  if (identity.warning) {
    errors.push(identity.warning);
  }

  const rawData = {
    headers: tab.headers,
    values: row.values.map((value) => String(value ?? ''))
  };

  return {
    sourceTabId: tab.sourceTabId,
    externalTabId: tab.externalTabId,
    rowNumber: row.rowNumber,
    rawData,
    normalizedData: normalizedFields,
    normalizedFields,
    validationErrors: errors,
    validationStatus: validationStatus(errors),
    externalRowId: identity.externalRowId,
    identityType: identity.identityType,
    rowHash: createSourceRowHash({
      headerHash: tab.headerHash,
      values: row.values,
      normalizedFields
    })
  } satisfies NormalizedReadRow;
}

export function normalizeReadSourceTab(tab: ReadSourceTabResult) {
  return markDuplicateAutomationIds(tab.rows.map((row) => normalizeRow(tab, row)));
}
