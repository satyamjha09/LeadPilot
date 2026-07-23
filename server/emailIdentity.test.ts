import { describe, expect, it } from 'vitest';
import { createEmailEventKey, EMAIL_TYPES } from './emailIdentity';

describe('email event identity', () => {
  it('keys Demo Done emails by active demo session', () => {
    const base = {
      automationId: 'lead_123',
      recipient: 'moh@example.com',
      emailType: EMAIL_TYPES.DEMO_DONE,
      date: '15-06-2026',
      time: '15:30'
    };

    const firstSessionKey = createEmailEventKey({ ...base, sessionId: 'session-1' });
    const duplicateSessionKey = createEmailEventKey({ ...base, sessionId: 'session-1' });
    const secondSessionKey = createEmailEventKey({ ...base, sessionId: 'session-2' });

    expect(duplicateSessionKey).toBe(firstSessionKey);
    expect(secondSessionKey).not.toBe(firstSessionKey);
  });

  it('does not let sheet date or time changes alter Demo Done idempotency for the same session', () => {
    const firstKey = createEmailEventKey({
      automationId: 'lead_123',
      recipient: 'moh@example.com',
      emailType: EMAIL_TYPES.DEMO_DONE,
      sessionId: 'session-1',
      date: '15-06-2026',
      time: '15:30'
    });
    const changedSheetTimeKey = createEmailEventKey({
      automationId: 'lead_123',
      recipient: 'moh@example.com',
      emailType: EMAIL_TYPES.DEMO_DONE,
      sessionId: 'session-1',
      date: '23-07-2026',
      time: '14:00'
    });

    expect(changedSheetTimeKey).toBe(firstKey);
  });

  it('requires a session id for Demo Done event keys', () => {
    expect(() =>
      createEmailEventKey({
        automationId: 'lead_123',
        recipient: 'moh@example.com',
        emailType: EMAIL_TYPES.DEMO_DONE,
        date: '15-06-2026',
        time: '15:30'
      })
    ).toThrow('Cannot create DEMO_DONE event key without event details.');
  });
});
