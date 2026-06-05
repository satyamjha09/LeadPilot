import { ExcelRow } from '@/src/types';
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

export const canScheduleDemo = (row: ExcelRow) =>
  normalizeStatus(row.lead_status) === 'demo scheduled' && !hasMeetLink(row['Meeting Details']);

export const canSendThankYou = (row: ExcelRow) =>
  normalizeStatus(row.lead_status) === 'demo done';

export const isStatusOnly = (row: ExcelRow) =>
  [
    'no response',
    'follow up',
    'to be called',
    'not required',
    'repeated',
    'reschedule'
  ].includes(normalizeStatus(row.lead_status));

export const canProcessLead = (row: ExcelRow) =>
  canScheduleDemo(row) || canSendThankYou(row) || isStatusOnly(row);

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
