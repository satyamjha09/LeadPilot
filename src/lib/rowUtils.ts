import { ExcelRow } from '@/src/types';
import { normalizeDisplayDate, normalizeIsoDate } from '@/src/lib/dateFormat';
import { LEAD_STATUS, LeadStatusLabel, getRowLeadStatus, normalizeLeadStatus } from '@/src/lib/leadStatus';

export type { LeadStatusLabel };

export type DashboardView =
  | 'dashboard'
  | 'import'
  | 'all'
  | 'pending'
  | 'scheduled'
  | 'failed'
  | 'settings';

export const getLeadStatus = (row: ExcelRow): LeadStatusLabel | 'Failed' | '' => {
  if (row.__schedulerStatus === 'Failed') return 'Failed';
  return getRowLeadStatus(row.lead_status);
};

export const hasMeetLink = (value: unknown) => /meet\.google\.com/i.test(String(value || ''));

export const normalizeStatus = (status: unknown) =>
  String(normalizeLeadStatus(status) || status || '').trim().toLowerCase();

const pad = (value: number) => String(value).padStart(2, '0');

export function normalizeMeetingDate(value: unknown) {
  return normalizeDisplayDate(value);
}

export function normalizeMeetingTime(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const totalMinutes = Math.round(value * 24 * 60);
    return `${pad(Math.floor(totalMinutes / 60) % 24)}:${pad(totalMinutes % 60)}`;
  }

  const raw = String(value || '').trim().replace(/:+/g, ':');
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

export function isMeetingAction(row: ExcelRow) {
  const status = normalizeStatus(row.lead_status);
  return status === 'demo scheduled' || status === 'reschedule';
}

export function getMeetingTimeKey(row: ExcelRow) {
  const date = normalizeMeetingDate(row['Date of Demo']);
  const time = normalizeMeetingTime(row['Time of Demo']);
  return date && time ? `${date}__${time}` : '';
}

export function findTimeConflicts(rows: ExcelRow[]) {
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
      return { key, date, time, rows: groupRows };
    });
}

export const canScheduleDemo = (row: ExcelRow) =>
  normalizeStatus(row.lead_status) === 'demo scheduled' && !hasMeetLink(row['Meeting Details']);

export const hasMeetingStarted = (row: ExcelRow) => {
  const date = normalizeIsoDate(row['Date of Demo']);
  const time = normalizeMeetingTime(row['Time of Demo']);
  if (!date || !time) return false;
  const parsed = Date.parse(`${date} ${time}`);
  return Number.isFinite(parsed) && parsed <= Date.now();
};

export const canSendThankYou = (row: ExcelRow) =>
  normalizeStatus(row.lead_status) === 'demo done' &&
  hasMeetLink(row['Meeting Details']) &&
  hasMeetingStarted(row);

export const canRescheduleDemo = (row: ExcelRow) =>
  normalizeStatus(row.lead_status) === 'reschedule' && hasMeetLink(row['Meeting Details']);

export const isActiveDemoRow = (row: ExcelRow) =>
  getLeadStatus(row) === LEAD_STATUS.DEMO_SCHEDULED && hasMeetLink(row['Meeting Details']);

export const canStartReschedule = (row: ExcelRow) => isActiveDemoRow(row);

export const canMarkDemoOutcome = (row: ExcelRow) => isActiveDemoRow(row) && hasMeetingStarted(row);

export const canScheduleNewDemo = (row: ExcelRow) =>
  (getLeadStatus(row) === LEAD_STATUS.DEMO_DONE || getLeadStatus(row) === LEAD_STATUS.NO_RESPONSE) &&
  !hasMeetLink(row['Meeting Details']);

export const isStatusOnly = (row: ExcelRow) =>
  [
    'follow up',
    'to be called',
    'not required',
    'repeated'
  ].includes(normalizeStatus(row.lead_status));

export const canMarkNoResponse = (row: ExcelRow) =>
  normalizeStatus(row.lead_status) === 'no response' &&
  hasMeetLink(row['Meeting Details']) &&
  hasMeetingStarted(row);

export const canProcessLead = (row: ExcelRow) =>
  canScheduleDemo(row) || canSendThankYou(row) || canRescheduleDemo(row) || canMarkNoResponse(row) || isStatusOnly(row);

export const isDemoScheduledComplete = (row: ExcelRow) =>
  getLeadStatus(row) === LEAD_STATUS.DEMO_SCHEDULED && hasMeetLink(row['Meeting Details']);

export const canSelectForDemoSchedule = canScheduleDemo;

export const canSelectForThankYou = canSendThankYou;

export const filterRowsByView = (
  rows: ExcelRow[],
  view: DashboardView,
  searchQuery: string,
  statusFilter: string
) => {
  let filtered = rows;

  if (view === 'pending') {
    filtered = filtered.filter((row) => canProcessLead(row));
  }
  if (view === 'scheduled') {
    filtered = filtered.filter((row) => getLeadStatus(row) === LEAD_STATUS.DEMO_SCHEDULED);
  }
  if (view === 'failed') {
    filtered = filtered.filter((row) => getLeadStatus(row) === 'Failed');
  }

  if (statusFilter !== 'all') {
    const normalizedFilter = normalizeLeadStatus(statusFilter) || statusFilter;
    filtered = filtered.filter((row) => {
      const status = getLeadStatus(row);
      if (normalizedFilter === 'Failed') return status === 'Failed';
      return status === normalizedFilter;
    });
  }

  const query = searchQuery.trim().toLowerCase();
  if (!query) return filtered;

  return filtered.filter((row) => {
    const name = String(row.full_name || '').toLowerCase();
    const email = String(row.email || '').toLowerCase();
    return name.includes(query) || email.includes(query);
  });
};

export const computeStats = (rows: ExcelRow[]) => ({
  total: rows.length,
  demoScheduled: rows.filter((row) => getLeadStatus(row) === LEAD_STATUS.DEMO_SCHEDULED).length,
  demoDone: rows.filter((row) => getLeadStatus(row) === LEAD_STATUS.DEMO_DONE).length,
  noResponse: rows.filter((row) => getLeadStatus(row) === LEAD_STATUS.NO_RESPONSE).length,
  followUp: rows.filter((row) => getLeadStatus(row) === LEAD_STATUS.FOLLOW_UP).length,
  toBeCalled: rows.filter((row) => getLeadStatus(row) === LEAD_STATUS.TO_BE_CALLED).length,
  notRequired: rows.filter((row) => getLeadStatus(row) === LEAD_STATUS.NOT_REQUIRED).length,
  repeated: rows.filter((row) => getLeadStatus(row) === LEAD_STATUS.REPEATED).length,
  reschedule: rows.filter((row) => getLeadStatus(row) === LEAD_STATUS.RESCHEDULE).length,
  failed: rows.filter((row) => getLeadStatus(row) === 'Failed').length,
  readyToSchedule: rows.filter((row) => canSelectForDemoSchedule(row)).length
});
