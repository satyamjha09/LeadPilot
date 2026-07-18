import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leadpilot-reminders-'));
process.env.DATA_DIR = tempDataDir;
fs.writeFileSync(
  path.join(tempDataDir, 'reminder_config.json'),
  JSON.stringify({ enabled: true, offsetMinutes: 120 }),
  'utf-8'
);

const sendGmailReminderMock = vi.hoisted(() => vi.fn());
const sendGmailTemplateMock = vi.hoisted(() => vi.fn());

vi.mock('./googleAuth', () => ({
  sendGmailReminder: sendGmailReminderMock,
  sendGmailTemplate: sendGmailTemplateMock
}));

const buildReminderEmailMock = vi.hoisted(() => vi.fn());

vi.mock('./emailTemplates', () => ({
  buildReminderEmail: buildReminderEmailMock
}));

const emailDeliveryMock = vi.hoisted(() => ({
  claimEmailDelivery: vi.fn(),
  claimEmailRetryById: vi.fn(),
  listDueEmailRetries: vi.fn(),
  markEmailDeliveryFailed: vi.fn(),
  markEmailDeliverySent: vi.fn()
}));

vi.mock('./emailDelivery', () => emailDeliveryMock);

const prismaMock = vi.hoisted(() => ({
  demoHistory: {
    findMany: vi.fn(),
    update: vi.fn()
  },
  customerDemoState: {
    findUnique: vi.fn()
  }
}));

vi.mock('./db', () => ({
  prisma: prismaMock
}));

const { checkAndSendReminders } = await import('./reminders');
const { runEmailRetryScanner } = await import('./emailRetryWorker');

describe('brand-scoped background email delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildReminderEmailMock.mockReturnValue({
      subject: 'Reminder',
      text: 'Reminder text',
      html: '<p>Reminder</p>'
    });
    emailDeliveryMock.claimEmailDelivery.mockResolvedValue({
      claimed: true,
      deliveryId: 'delivery-1',
      attemptCount: 1
    });
    emailDeliveryMock.claimEmailRetryById.mockResolvedValue(true);
    emailDeliveryMock.markEmailDeliverySent.mockResolvedValue({});
    emailDeliveryMock.markEmailDeliveryFailed.mockResolvedValue('FAILED');
    sendGmailReminderMock.mockResolvedValue({ messageId: 'gmail-reminder-1' });
    sendGmailTemplateMock.mockResolvedValue({ messageId: 'gmail-retry-1' });
    prismaMock.demoHistory.update.mockResolvedValue({});
  });

  it('sends AnyWhereTally reminders with the DemoHistory brand', async () => {
    const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    prismaMock.demoHistory.findMany.mockResolvedValue([
      {
        sessionId: 'session-awt',
        userId: 'lead_123',
        emailBrand: 'anywheretally',
        fullName: 'Moh Agarwal',
        email: 'moh@example.com',
        displayDate: '15-06-2026',
        displayTime: '15:30',
        meetingLink: 'https://meet.google.com/awt-demo',
        scheduledStartUtc: start
      }
    ]);
    prismaMock.customerDemoState.findUnique.mockResolvedValue({
      emailBrand: 'anywheretally',
      userId: 'lead_123',
      status: 'Demo Scheduled',
      activeDemoSessionId: 'session-awt',
      meetingLink: 'https://meet.google.com/awt-demo',
      demoDate: '15-06-2026',
      demoTime: '15:30'
    });

    await checkAndSendReminders();

    expect(buildReminderEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ brand: 'anywheretally' })
    );
    expect(emailDeliveryMock.claimEmailDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ emailBrand: 'anywheretally' })
    );
    expect(sendGmailReminderMock).toHaveBeenCalledWith(
      'Moh Agarwal',
      'moh@example.com',
      '15-06-2026',
      '15:30',
      'https://meet.google.com/awt-demo',
      'anywheretally'
    );
  });

  it('sends TallyKonnect reminders with the DemoHistory brand', async () => {
    const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    prismaMock.demoHistory.findMany.mockResolvedValue([
      {
        sessionId: 'session-tk',
        userId: 'lead_456',
        emailBrand: 'tallykonnect',
        fullName: 'Sai Kumar',
        email: 'sai@example.com',
        displayDate: '16-06-2026',
        displayTime: '11:00',
        meetingLink: 'https://meet.google.com/tk-demo',
        scheduledStartUtc: start
      }
    ]);
    prismaMock.customerDemoState.findUnique.mockResolvedValue({
      emailBrand: 'tallykonnect',
      userId: 'lead_456',
      status: 'Demo Scheduled',
      activeDemoSessionId: 'session-tk',
      meetingLink: 'https://meet.google.com/tk-demo',
      demoDate: '16-06-2026',
      demoTime: '11:00'
    });

    await checkAndSendReminders();

    expect(sendGmailReminderMock).toHaveBeenCalledWith(
      'Sai Kumar',
      'sai@example.com',
      '16-06-2026',
      '11:00',
      'https://meet.google.com/tk-demo',
      'tallykonnect'
    );
  });

  it('sends automatic retries with EmailDelivery.emailBrand', async () => {
    emailDeliveryMock.listDueEmailRetries.mockResolvedValue([
      {
        id: 'retry-awt',
        eventKey: 'event-1',
        automationId: 'lead_123',
        emailBrand: 'anywheretally',
        emailType: 'DEMO_DONE',
        recipient: 'moh@example.com',
        payloadHash: 'payload',
        subject: 'Retry',
        textBody: 'Retry text',
        htmlBody: '<p>Retry</p>',
        attemptCount: 1,
        retryCount: 1,
        maxRetries: 3,
        nextRetryAt: new Date()
      }
    ]);

    await runEmailRetryScanner();

    expect(sendGmailTemplateMock).toHaveBeenCalledWith(
      'moh@example.com',
      {
        subject: 'Retry',
        text: 'Retry text',
        html: '<p>Retry</p>'
      },
      'anywheretally'
    );
  });

  it('manual retry route uses persisted delivery brand', () => {
    const routeSource = fs.readFileSync(path.join(process.cwd(), 'server', 'routes', 'leadRoutes.ts'), 'utf-8');

    expect(routeSource).toContain('sendGmailTemplate(delivery.recipient');
    expect(routeSource).toContain('}, delivery.emailBrand)');
  });
});
