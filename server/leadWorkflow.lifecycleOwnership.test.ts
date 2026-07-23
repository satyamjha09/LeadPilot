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

describe('lead workflow lifecycle ownership guards', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'server', 'leadWorkflow.ts'), 'utf-8');

  it('checks reschedule ownership before updating Calendar', () => {
    const body = functionSource(source, 'rescheduleDemoForRow', 'updateLeadStatusOnly');

    expect(body.indexOf('assertDemoLifecycleOwnership(row, context.emailBrand, senderAccountKeyForContext(context))')).toBeLessThan(
      body.indexOf('updateCalendarMeeting(')
    );
    expect(body).toContain('sendGmailRescheduleInvite(updatedRow, meetLink');
    expect(body).toContain('senderAccountKeyForContext(ownerContext)');
    expect(body).toContain('emailBrandKeyForContext(ownerContext)');
  });

  it('sends Demo Done using the resolved owner brand', () => {
    const body = functionSource(source, 'sendThankYouForRow', 'sendNoResponseForRow');

    expect(body).toContain('const ownerBrand = active.emailBrand');
    expect(body).toContain('__senderAccountKey: senderAccountKeyForContext(ownerContext)');
    expect(body).toContain('__demoSessionId: sessionId');
    expect(body.indexOf('commitDemoOutcomeAndEmailIntent(ownerRow, LEAD_STATUS.DEMO_DONE, ownerBrand')).toBeLessThan(
      body.indexOf('sendPendingOutcomeEmail({')
    );
    expect(body).toContain('emailType: EMAIL_TYPES.DEMO_DONE');
    expect(body).toContain('demoSessionId: sessionId');
    expect(body).toContain('sendThankYouEmail({');
    expect(body).toContain('senderAccountKey: senderAccountKeyForContext(ownerContext)');
    expect(body).toContain('emailBrandKey: emailBrandKeyForContext(ownerContext)');
    expect(body).toContain("'Meeting Details': ''");
  });

  it('sends Not Attended using the resolved owner brand', () => {
    const body = functionSource(source, 'sendNoResponseForRow', 'rescheduleDemoForRow');

    expect(body).toContain('const ownerBrand = active.emailBrand');
    expect(body).toContain('__senderAccountKey: senderAccountKeyForContext(ownerContext)');
    expect(body).toContain('__demoSessionId: sessionId');
    expect(body.indexOf('commitDemoOutcomeAndEmailIntent(ownerRow, LEAD_STATUS.NO_RESPONSE, ownerBrand')).toBeLessThan(
      body.indexOf('sendPendingOutcomeEmail({')
    );
    expect(body).toContain('emailType: EMAIL_TYPES.NO_RESPONSE');
    expect(body).toContain('demoSessionId: sessionId');
    expect(body).toContain('sendNoResponseEmail({');
    expect(body).toContain('senderAccountKey: senderAccountKeyForContext(ownerContext)');
    expect(body).toContain('emailBrandKey: emailBrandKeyForContext(ownerContext)');
    expect(body).toContain("'Meeting Details': ''");
  });

  it('keeps provider-sent outcome emails final when metadata reconciliation fails', () => {
    const start = source.indexOf('async function sendPendingOutcomeEmail');
    const end = source.indexOf('function flattenPlannedRows', start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);

    expect(body).toContain('OUTCOME_EMAIL_SENT_STATE_RECONCILE_FAILED');
    expect(body).toContain('OUTCOME_EMAIL_METADATA_RECONCILE_FAILED');
    const providerSend = body.indexOf('await input.send()');
    const markSent = body.indexOf('await markEmailDeliverySent({', providerSend);
    const markOutcome = body.indexOf('await markOutcomeEmailSent(input.sessionId, input.status)', markSent);
    expect(providerSend).toBeGreaterThanOrEqual(0);
    expect(markSent).toBeGreaterThan(providerSend);
    expect(markOutcome).toBeGreaterThan(markSent);
  });

  it('validates Demo Done and Not Attended against DB session time only', () => {
    const start = source.indexOf('async function assertManualCloseAllowed');
    const end = source.indexOf('function sheetRowNumber', start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);

    expect(body).toContain('const scheduledStartUtc = active.history?.scheduledStartUtc || active.state.demoStartUtc');
    expect(body).not.toContain("parseExcelDateTime(row['Date of Demo'], row['Time of Demo'])");
  });

  it('writes a blank Meeting Details value for Demo Done sheet updates', () => {
    const start = source.indexOf('for (let index = 0; index < plan.demoDoneRows.length; index++)');
    const end = source.indexOf('for (const row of plan.statusOnlyRows)', start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);

    expect(body).toContain("'Meeting Details': ''");
    expect(body).toContain('lastMeetingLink: null');
  });

  it('force-close cancels Calendar before clearing database ownership', () => {
    const routeSource = fs.readFileSync(path.join(process.cwd(), 'server', 'routes', 'leadRoutes.ts'), 'utf-8');
    const start = routeSource.indexOf("app.post('/api/active-demo/force-close'");
    const end = routeSource.indexOf("app.post('/api/email-deliveries/:deliveryId/mark-sent'", start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = routeSource.slice(start, end);

    expect(body.indexOf('assertDemoLifecycleOwnership(row, keys.emailBrandKey, keys.senderAccountKey)')).toBeLessThan(
      body.indexOf('cancelCalendarMeeting(calendarEventId, active.senderAccountKey)')
    );
    expect(body.indexOf('cancelCalendarMeeting(calendarEventId, active.senderAccountKey)')).toBeLessThan(
      body.indexOf('forceCloseActiveDemoForRow(row, remarks, keys.emailBrandKey, active.senderAccountKey)')
    );
  });
});
