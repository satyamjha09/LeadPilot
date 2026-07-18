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

    expect(body.indexOf('assertDemoBrandOwnership(row, context.emailBrand)')).toBeLessThan(
      body.indexOf('updateCalendarMeeting(row, active.state.calendarEventId, ownerBrand)')
    );
    expect(body).toContain('sendGmailRescheduleInvite(updatedRow, meetLink');
    expect(body).toContain('}, ownerBrand)');
  });

  it('sends Demo Done using the resolved owner brand', () => {
    const body = functionSource(source, 'sendThankYouForRow', 'sendNoResponseForRow');

    expect(body).toContain('const ownerBrand = active.emailBrand');
    expect(body).toContain('sendThankYouEmail(ownerRow, ownerBrand)');
    expect(body).toContain('closeActiveDemoForRow(ownerRow, LEAD_STATUS.DEMO_DONE, ownerBrand');
  });

  it('sends Not Attended using the resolved owner brand', () => {
    const body = functionSource(source, 'sendNoResponseForRow', 'rescheduleDemoForRow');

    expect(body).toContain('const ownerBrand = active.emailBrand');
    expect(body).toContain('sendNoResponseEmail(ownerRow, ownerBrand)');
    expect(body).toContain('closeActiveDemoForRow(ownerRow, LEAD_STATUS.NO_RESPONSE, ownerBrand');
  });
});
