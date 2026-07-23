import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function functionSource(source: string, name: string, nextName: string) {
  const start = source.indexOf(`export async function ${name}`);
  const end = source.indexOf(`export async function ${nextName}`, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function internalFunctionSource(source: string, name: string, nextMarker: string) {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(nextMarker, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('lead workflow lifecycle ownership guards', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'server', 'leadWorkflow.ts'), 'utf-8');

  it('checks reschedule ownership before updating Calendar', () => {
    const body = functionSource(source, 'rescheduleDemoForRow', 'updateLeadStatusOnly');

    expect(body.indexOf('assertDemoBrandOwnership(row, context.emailBrand)')).toBeLessThan(
      body.indexOf('updateCalendarMeeting(')
    );
    expect(body).toContain('sendGmailRescheduleInvite(updatedRow, meetLink');
    expect(body).toContain('senderAccountKeyForContext(ownerContext)');
    expect(body).toContain('emailBrandKeyForContext(ownerContext)');
  });

  it('sends Demo Done using the resolved owner brand', () => {
    const body = functionSource(source, 'sendThankYouForRow', 'sendNoResponseForRow');

    expect(body).toContain('const ownerBrand = active.emailBrand');
    expect(body).toContain('sendThankYouEmail({');
    expect(body).toContain('senderAccountKey: senderAccountKeyForContext(ownerContext)');
    expect(body).toContain('emailBrandKey: emailBrandKeyForContext(ownerContext)');
    expect(body).toContain('sessionId: active.history?.sessionId || active.state.activeDemoSessionId');
    expect(body).toContain("meetingLink: ''");
    expect(body).toContain("'Meeting Details': ''");
    expect(body).toContain('closeActiveDemoForRow(ownerRow, LEAD_STATUS.DEMO_DONE, ownerBrand');
  });

  it('clears Google Sheet meeting details for Demo Done batch updates', () => {
    const body = functionSource(source, 'processLeadsByStatus', 'sendThankYouForRow');
    const demoDoneLoopStart = body.indexOf('for (let index = 0; index < plan.demoDoneRows.length; index++)');
    const statusOnlyLoopStart = body.indexOf('for (const row of plan.statusOnlyRows)', demoDoneLoopStart);
    expect(demoDoneLoopStart).toBeGreaterThanOrEqual(0);
    expect(statusOnlyLoopStart).toBeGreaterThan(demoDoneLoopStart);

    const demoDoneLoop = body.slice(demoDoneLoopStart, statusOnlyLoopStart);
    expect(demoDoneLoop).toContain("collectSheetUpdate(sheetUpdates, result.row, {");
    expect(demoDoneLoop).toContain("'Meeting Details': ''");
  });

  it('uses only the active database demo time for Demo Done and Not Attended close validation', () => {
    const body = internalFunctionSource(source, 'assertManualCloseAllowed', 'function sheetRowNumber');

    expect(body).toContain('hasMeetingStarted(active.state.demoStartUtc)');
    expect(body).not.toContain("parseExcelDateTime(row['Date of Demo'], row['Time of Demo'])");
    expect(body).not.toContain('rowStartUtc');
  });

  it('only applies sheet time-conflict validation to schedule and reschedule rows', () => {
    const body = functionSource(source, 'buildProcessLeadPlan', 'processLeadsByStatus');
    const validationFilterStart = body.indexOf('const rowsRequiringSheetTimeValidation = rows.filter');
    const conflictCallStart = body.indexOf('const timeConflictGroups = findTimeConflictGroups(rowsRequiringSheetTimeValidation)');
    expect(validationFilterStart).toBeGreaterThanOrEqual(0);
    expect(conflictCallStart).toBeGreaterThan(validationFilterStart);

    const validationFilter = body.slice(validationFilterStart, conflictCallStart);
    expect(validationFilter).toContain('normalized === LEAD_STATUS.DEMO_SCHEDULED');
    expect(validationFilter).toContain('normalized === LEAD_STATUS.RESCHEDULE');
    expect(validationFilter).not.toContain('LEAD_STATUS.DEMO_DONE');
    expect(validationFilter).not.toContain('LEAD_STATUS.NO_RESPONSE');
  });

  it('sends Not Attended using the resolved owner brand', () => {
    const body = functionSource(source, 'sendNoResponseForRow', 'rescheduleDemoForRow');

    expect(body).toContain('const ownerBrand = active.emailBrand');
    expect(body).toContain('sendNoResponseEmail({');
    expect(body).toContain('senderAccountKey: senderAccountKeyForContext(ownerContext)');
    expect(body).toContain('emailBrandKey: emailBrandKeyForContext(ownerContext)');
    expect(body).toContain('closeActiveDemoForRow(ownerRow, LEAD_STATUS.NO_RESPONSE, ownerBrand');
  });
});
