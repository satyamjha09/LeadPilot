import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExcelRow } from '../src/types';

const googleMock = vi.hoisted(() => {
  const oauth2Ctor = vi.fn(function OAuth2Mock(this: any) {
    this.setCredentials = vi.fn();
    this.on = vi.fn();
    this.generateAuthUrl = vi.fn(() => 'https://accounts.google.com/mock');
  });
  const gmailSend = vi.fn();
  const calendarInsert = vi.fn();
  const calendarPatch = vi.fn();
  const sheetsBatchUpdate = vi.fn();

  return {
    oauth2Ctor,
    gmailSend,
    calendarInsert,
    calendarPatch,
    sheetsBatchUpdate
  };
});

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: googleMock.oauth2Ctor
    },
    gmail: vi.fn(() => ({
      users: {
        messages: {
          send: googleMock.gmailSend
        }
      }
    })),
    calendar: vi.fn(() => ({
      events: {
        insert: googleMock.calendarInsert,
        patch: googleMock.calendarPatch
      }
    })),
    sheets: vi.fn(() => ({
      spreadsheets: {
        values: {
          batchUpdate: googleMock.sheetsBatchUpdate
        }
      }
    }))
  }
}));

const prismaMock = vi.hoisted(() => ({
  googleAuth: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn()
  }
}));

vi.mock('./db', () => ({
  prisma: prismaMock
}));

const {
  scheduleMeeting,
  sendGmailInvite,
  sendGmailReminder,
  sendGmailRescheduleInvite,
  sendNoResponseEmail,
  sendThankYouEmail,
  updateCalendarMeeting
} = await import('./googleAuth');
const { updateGoogleSheetRowsResilient } = await import('./googleSheets');

const row: ExcelRow = {
  id: 'row-1',
  full_name: 'Codekar',
  email: 'lead@example.com',
  automation_id: 'lead_123',
  'Date of Demo': '15-06-2026',
  'Time of Demo': '15:30',
  lead_status: 'Demo Scheduled'
};

function decodeRawEmail(raw: string) {
  return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function lastOAuthClientId() {
  const calls = googleMock.oauth2Ctor.mock.calls as unknown as any[][];
  return calls.at(-1)?.[0];
}

const brandCases = [
  {
    brand: 'tallykonnect' as const,
    googleAccountKey: 'tallykonnect-google' as const,
    clientId: 'tally-client',
    sender: 'TallyKonnect <demo.tallykonnect@gmail.com>',
    calendarName: 'TallyKonnect',
    emailName: 'TallyKonnect',
    meetLink: 'https://meet.google.com/tally-demo'
  },
  {
    brand: 'anywheretally' as const,
    googleAccountKey: 'anywheretally-google' as const,
    clientId: 'awt-client',
    sender: 'AnyWhereTally <info.anywheretally@gmail.com>',
    calendarName: 'AnyWhereTally',
    emailName: 'AnyWhereTally',
    meetLink: 'https://meet.google.com/awt-demo'
  }
];

describe('two-brand Google client routing regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'tally-client';
    process.env.GOOGLE_CLIENT_SECRET = 'tally-secret';
    process.env.GOOGLE_AUTH_EMAIL = 'demo.tallykonnect@gmail.com';
    process.env.GMAIL_FROM_EMAIL = 'demo.tallykonnect@gmail.com';
    process.env.GMAIL_FROM_NAME = 'TallyKonnect';
    process.env.GOOGLE_ANYWHERETALLY_CLIENT_ID = 'awt-client';
    process.env.GOOGLE_ANYWHERETALLY_CLIENT_SECRET = 'awt-secret';
    process.env.GOOGLE_ANYWHERETALLY_AUTH_EMAIL = 'info.anywheretally@gmail.com';
    process.env.GMAIL_ANYWHERETALLY_FROM_EMAIL = 'info.anywheretally@gmail.com';
    prismaMock.googleAuth.findUnique.mockResolvedValue(null);
    googleMock.gmailSend.mockResolvedValue({
      data: {
        id: 'gmail-message-1',
        threadId: 'gmail-thread-1'
      }
    });
    googleMock.calendarInsert.mockResolvedValue({
      data: {
        id: 'calendar-event-1',
        hangoutLink: 'https://meet.google.com/generated-demo'
      }
    });
    googleMock.calendarPatch.mockResolvedValue({
      data: {
        id: 'calendar-event-1',
        hangoutLink: 'https://meet.google.com/rescheduled-demo'
      }
    });
    googleMock.sheetsBatchUpdate.mockResolvedValue({ data: {} });
  });

  it.each(brandCases)('creates demo Calendar events and invitation emails using $emailName', async (entry) => {
    await scheduleMeeting(row, entry.brand);

    expect(lastOAuthClientId()).toBe(entry.clientId);
    expect(googleMock.calendarInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          summary: expect.stringContaining(entry.calendarName),
          description: expect.stringContaining(entry.calendarName)
        })
      })
    );

    await sendGmailInvite(row, entry.meetLink, entry.brand);
    const decoded = decodeRawEmail(googleMock.gmailSend.mock.calls.at(-1)?.[0].requestBody.raw);

    expect(lastOAuthClientId()).toBe(entry.clientId);
    expect(decoded).toContain(`From: ${entry.sender}`);
    expect(decoded).toContain(entry.emailName);
    expect(decoded).toContain(entry.meetLink);
  });

  it.each(brandCases)('routes reschedule, Demo Done, Not Attended, and reminder emails through $emailName', async (entry) => {
    await updateCalendarMeeting(row, 'calendar-event-1', entry.brand);
    expect(lastOAuthClientId()).toBe(entry.clientId);
    expect(googleMock.calendarPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'calendar-event-1',
        requestBody: expect.objectContaining({
          summary: expect.stringContaining(entry.calendarName),
          description: expect.stringContaining(entry.calendarName)
        })
      })
    );

    await sendGmailRescheduleInvite(row, entry.meetLink, { date: '14-06-2026', time: '14:30' }, entry.brand);
    await sendThankYouEmail(row, entry.brand);
    await sendNoResponseEmail(row, entry.brand);
    await sendGmailReminder('Codekar', 'lead@example.com', '15-06-2026', '15:30', entry.meetLink, entry.brand);

    const sentMessages = googleMock.gmailSend.mock.calls.slice(-4).map((call) => decodeRawEmail(call[0].requestBody.raw));
    for (const decoded of sentMessages) {
      expect(decoded).toContain(`From: ${entry.sender}`);
      expect(decoded).toContain(entry.emailName);
    }
  });

  it.each(brandCases)('updates Google Sheets using $emailName OAuth', async (entry) => {
    await updateGoogleSheetRowsResilient(
      'spreadsheet-1',
      'Leads',
      ['Meeting Details', 'lead_status', 'Remarks', 'automation_id'],
      [
        {
          rowNumber: 2,
          values: {
            'Meeting Details': entry.meetLink,
            lead_status: 'Demo Scheduled',
            Remarks: 'Meeting scheduled and email sent'
          }
        }
      ],
      {},
      { workspaceKey: entry.brand, googleAccountKey: entry.googleAccountKey }
    );

    expect(lastOAuthClientId()).toBe(entry.clientId);
    expect(googleMock.sheetsBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: 'spreadsheet-1',
        requestBody: expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              range: "'Leads'!A2"
            })
          ])
        })
      })
    );
  });
});
