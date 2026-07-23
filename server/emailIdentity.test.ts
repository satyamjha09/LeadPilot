import { describe, expect, it } from 'vitest';
import type { ExcelRow } from '../src/types';
import {
  createEmailEventKey,
  EMAIL_TYPES,
  getAutomationId,
  MissingPermanentAutomationIdError
} from './emailIdentity';

describe('email identity strict lifecycle keys', () => {
  it('requires a permanent automation_id before creating workflow email identity', () => {
    const row = {
      id: 'row-1',
      email: 'moh@example.com'
    } satisfies ExcelRow;

    expect(() => getAutomationId(row, { sourceType: 'excel' })).toThrow(MissingPermanentAutomationIdError);
  });

  it('uses demoSessionId, not sheet date/time, for Demo Done idempotency', () => {
    const first = createEmailEventKey({
      automationId: 'lead_123',
      recipient: 'moh@example.com',
      emailType: EMAIL_TYPES.DEMO_DONE,
      sessionId: 'demo_session_1',
      date: '23-07-2026',
      time: '14:00'
    });
    const second = createEmailEventKey({
      automationId: 'lead_123',
      recipient: 'moh@example.com',
      emailType: EMAIL_TYPES.DEMO_DONE,
      sessionId: 'demo_session_1',
      date: '24-07-2026',
      time: '15:00'
    });
    const nextSession = createEmailEventKey({
      automationId: 'lead_123',
      recipient: 'moh@example.com',
      emailType: EMAIL_TYPES.DEMO_DONE,
      sessionId: 'demo_session_2',
      date: '23-07-2026',
      time: '14:00'
    });

    expect(first).toBe(second);
    expect(first).not.toBe(nextSession);
  });

  it('rejects terminal outcome keys without a demo session id', () => {
    expect(() =>
      createEmailEventKey({
        automationId: 'lead_123',
        recipient: 'moh@example.com',
        emailType: EMAIL_TYPES.NO_RESPONSE,
        date: '23-07-2026',
        time: '14:00'
      })
    ).toThrow('Cannot create NO_RESPONSE event key without event details.');
  });
});
