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
    expect(body).toContain('sendThankYouEmail({');
    expect(body).toContain('senderAccountKey: senderAccountKeyForContext(ownerContext)');
    expect(body).toContain('emailBrandKey: emailBrandKeyForContext(ownerContext)');
    expect(body).toContain('closeActiveDemoForRow(ownerRow, LEAD_STATUS.DEMO_DONE, ownerBrand');
  });

  it('sends Not Attended using the resolved owner brand', () => {
    const body = functionSource(source, 'sendNoResponseForRow', 'rescheduleDemoForRow');

    expect(body).toContain('const ownerBrand = active.emailBrand');
    expect(body).toContain('__senderAccountKey: senderAccountKeyForContext(ownerContext)');
    expect(body).toContain('sendNoResponseEmail({');
    expect(body).toContain('senderAccountKey: senderAccountKeyForContext(ownerContext)');
    expect(body).toContain('emailBrandKey: emailBrandKeyForContext(ownerContext)');
    expect(body).toContain('closeActiveDemoForRow(ownerRow, LEAD_STATUS.NO_RESPONSE, ownerBrand');
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
