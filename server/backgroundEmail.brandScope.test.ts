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
const markOutcomeEmailSentMock = vi.hoisted(() => vi.fn());

vi.mock('./googleAuth', () => ({
  sendGmailReminder: sendGmailReminderMock,
  sendGmailTemplate: sendGmailTemplateMock
}));

const buildReminderEmailMock = vi.hoisted(() => vi.fn());

vi.mock('./emailTemplates', () => ({
  buildReminderEmail: buildReminderEmailMock
}));

vi.mock('./scheduleDb', () => ({
  markOutcomeEmailSent: markOutcomeEmailSentMock
}));

const emailDeliveryMock = vi.hoisted(() => ({
  claimEmailDelivery: vi.fn(),
  claimEmailRetryById: vi.fn(),
  findEmailDeliveryById: vi.fn(),
  listDueEmailRetries: vi.fn(),
  markEmailDeliveryFailed: vi.fn(),
  markEmailDeliverySent: vi.fn(),
  reconcileOutcomeEmailMetadata: vi.fn()
}));

vi.mock('./emailDelivery', () => emailDeliveryMock);

const prismaMock = vi.hoisted(() => ({
  demoHistory: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn()
  },
  customerDemoState: {
    findUnique: vi.fn()
  },
  workflowControl: {
    findUnique: vi.fn()
  }
}));

vi.mock('./db', () => ({
  prisma: prismaMock
}));

const workflowActivityMock = vi.hoisted(() => ({
  withWorkflowActivity: vi.fn((_type: string, _emailBrand: string, action: () => unknown) => action()),
  WORKFLOW_BUSY_RESET_MESSAGE: 'A workflow is currently running. Wait for it to finish before resetting.'
}));

vi.mock('./workflowActivity', () => workflowActivityMock);

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
    emailDeliveryMock.findEmailDeliveryById.mockResolvedValue({ id: 'delivery-1', status: 'PROCESSING' });
    emailDeliveryMock.markEmailDeliverySent.mockResolvedValue({});
    emailDeliveryMock.markEmailDeliveryFailed.mockResolvedValue('FAILED');
    emailDeliveryMock.reconcileOutcomeEmailMetadata.mockResolvedValue({});
    sendGmailReminderMock.mockResolvedValue({ messageId: 'gmail-reminder-1' });
    sendGmailTemplateMock.mockResolvedValue({ messageId: 'gmail-retry-1' });
    markOutcomeEmailSentMock.mockResolvedValue({});
    prismaMock.demoHistory.update.mockResolvedValue({});
    prismaMock.demoHistory.findUnique.mockImplementation(async ({ where }: any) => ({
      sessionId: where.sessionId,
      status: 'Demo Scheduled',
      meetingLink: 'https://meet.google.com/awt-demo'
    }));
    prismaMock.workflowControl.findUnique.mockResolvedValue({ isResetting: false });
    workflowActivityMock.withWorkflowActivity.mockImplementation((_type: string, _emailBrand: string, action: () => unknown) => action());
  });

  it('sends AnyWhereTally reminders with the DemoHistory brand', async () => {
    const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    prismaMock.demoHistory.findMany.mockResolvedValue([
      {
        sessionId: 'session-awt',
        userId: 'lead_123',
        emailBrand: 'anywheretally',
        senderAccountKey: 'anywheretally-google',
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
      senderAccountKey: 'anywheretally-google',
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
      'anywheretally-google',
      'anywheretally'
    );
  });

  it('sends cross-combination reminders with persisted brand and sender', async () => {
    const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    prismaMock.demoHistory.findMany.mockResolvedValue([
      {
        sessionId: 'session-cross',
        userId: 'lead_cross',
        emailBrand: 'anywheretally',
        senderAccountKey: 'tallykonnect-google',
        fullName: 'Cross Owner',
        email: 'cross@example.com',
        displayDate: '17-06-2026',
        displayTime: '12:00',
        meetingLink: 'https://meet.google.com/cross-demo',
        scheduledStartUtc: start
      }
    ]);
    prismaMock.customerDemoState.findUnique.mockResolvedValue({
      emailBrand: 'anywheretally',
      senderAccountKey: 'tallykonnect-google',
      userId: 'lead_cross',
      status: 'Demo Scheduled',
      activeDemoSessionId: 'session-cross',
      meetingLink: 'https://meet.google.com/cross-demo',
      demoDate: '17-06-2026',
      demoTime: '12:00'
    });

    await checkAndSendReminders();

    expect(buildReminderEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ brand: 'anywheretally' })
    );
    expect(emailDeliveryMock.claimEmailDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        emailBrand: 'anywheretally',
        senderAccountKey: 'tallykonnect-google'
      })
    );
    expect(sendGmailReminderMock).toHaveBeenCalledWith(
      'Cross Owner',
      'cross@example.com',
      '17-06-2026',
      '12:00',
      'https://meet.google.com/cross-demo',
      'tallykonnect-google',
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
        senderAccountKey: 'tallykonnect-google',
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
      senderAccountKey: 'tallykonnect-google',
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
      'tallykonnect-google',
      'tallykonnect'
    );
  });

  it('skips reminders when active state sender ownership differs', async () => {
    const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    prismaMock.demoHistory.findMany.mockResolvedValue([
      {
        sessionId: 'session-mismatch',
        userId: 'lead_mismatch',
        emailBrand: 'anywheretally',
        senderAccountKey: 'tallykonnect-google',
        fullName: 'Mismatch Owner',
        email: 'mismatch@example.com',
        displayDate: '18-06-2026',
        displayTime: '13:00',
        meetingLink: 'https://meet.google.com/mismatch-demo',
        scheduledStartUtc: start
      }
    ]);
    prismaMock.customerDemoState.findUnique.mockResolvedValue({
      emailBrand: 'anywheretally',
      senderAccountKey: 'anywheretally-google',
      userId: 'lead_mismatch',
      status: 'Demo Scheduled',
      activeDemoSessionId: 'session-mismatch',
      meetingLink: 'https://meet.google.com/mismatch-demo',
      demoDate: '18-06-2026',
      demoTime: '13:00'
    });

    await checkAndSendReminders();

    expect(emailDeliveryMock.claimEmailDelivery).not.toHaveBeenCalled();
    expect(sendGmailReminderMock).not.toHaveBeenCalled();
    expect(prismaMock.demoHistory.update).not.toHaveBeenCalled();
  });

  it('skips stale reminder sessions without side effects', async () => {
    const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    prismaMock.demoHistory.findMany.mockResolvedValue([
      {
        sessionId: 'old-session',
        userId: 'lead_stale',
        emailBrand: 'tallykonnect',
        senderAccountKey: 'tallykonnect-google',
        fullName: 'Stale Owner',
        email: 'stale@example.com',
        displayDate: '19-06-2026',
        displayTime: '14:00',
        meetingLink: 'https://meet.google.com/stale-demo',
        scheduledStartUtc: start
      }
    ]);
    prismaMock.customerDemoState.findUnique.mockResolvedValue({
      emailBrand: 'tallykonnect',
      senderAccountKey: 'tallykonnect-google',
      userId: 'lead_stale',
      status: 'Demo Scheduled',
      activeDemoSessionId: 'new-session',
      meetingLink: 'https://meet.google.com/stale-demo',
      demoDate: '19-06-2026',
      demoTime: '14:00'
    });

    await checkAndSendReminders();

    expect(emailDeliveryMock.claimEmailDelivery).not.toHaveBeenCalled();
    expect(sendGmailReminderMock).not.toHaveBeenCalled();
    expect(prismaMock.demoHistory.update).not.toHaveBeenCalled();
  });

  it('reconciles already-sent reminder deliveries without sending Gmail again', async () => {
    const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    prismaMock.demoHistory.findMany.mockResolvedValue([
      {
        sessionId: 'session-sent',
        userId: 'lead_sent',
        emailBrand: 'tallykonnect',
        senderAccountKey: 'tallykonnect-google',
        fullName: 'Sent Owner',
        email: 'sent@example.com',
        displayDate: '20-06-2026',
        displayTime: '15:00',
        meetingLink: 'https://meet.google.com/sent-demo',
        scheduledStartUtc: start
      }
    ]);
    prismaMock.customerDemoState.findUnique.mockResolvedValue({
      emailBrand: 'tallykonnect',
      senderAccountKey: 'tallykonnect-google',
      userId: 'lead_sent',
      status: 'Demo Scheduled',
      activeDemoSessionId: 'session-sent',
      meetingLink: 'https://meet.google.com/sent-demo',
      demoDate: '20-06-2026',
      demoTime: '15:00'
    });
    emailDeliveryMock.claimEmailDelivery.mockResolvedValue({
      claimed: false,
      reason: 'ALREADY_SENT',
      deliveryId: 'delivery-sent',
      providerMessageId: 'gmail-sent'
    });

    await checkAndSendReminders();

    expect(sendGmailReminderMock).not.toHaveBeenCalled();
    expect(prismaMock.demoHistory.update).toHaveBeenCalledWith({
      where: { sessionId: 'session-sent' },
      data: expect.objectContaining({ reminder1HourSentAt: expect.any(String) })
    });
  });

  it('isolates invalid reminder sender ownership and continues later reminders', async () => {
    const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    prismaMock.demoHistory.findMany.mockResolvedValue([
      {
        sessionId: 'session-invalid-sender',
        userId: 'lead_invalid_sender',
        emailBrand: 'anywheretally',
        senderAccountKey: 'broken-sender',
        fullName: 'Broken Sender',
        email: 'broken@example.com',
        displayDate: '21-06-2026',
        displayTime: '16:00',
        meetingLink: 'https://meet.google.com/broken-demo',
        scheduledStartUtc: start
      },
      {
        sessionId: 'session-valid-after-invalid',
        userId: 'lead_valid_after_invalid',
        emailBrand: 'tallykonnect',
        senderAccountKey: 'tallykonnect-google',
        fullName: 'Valid Sender',
        email: 'valid@example.com',
        displayDate: '21-06-2026',
        displayTime: '16:30',
        meetingLink: 'https://meet.google.com/valid-demo',
        scheduledStartUtc: start
      }
    ]);
    prismaMock.customerDemoState.findUnique.mockResolvedValue({
      emailBrand: 'tallykonnect',
      senderAccountKey: 'tallykonnect-google',
      userId: 'lead_valid_after_invalid',
      status: 'Demo Scheduled',
      activeDemoSessionId: 'session-valid-after-invalid',
      meetingLink: 'https://meet.google.com/valid-demo',
      demoDate: '21-06-2026',
      demoTime: '16:30'
    });

    await checkAndSendReminders();

    expect(emailDeliveryMock.claimEmailDelivery).toHaveBeenCalledTimes(1);
    expect(sendGmailReminderMock).toHaveBeenCalledWith(
      'Valid Sender',
      'valid@example.com',
      '21-06-2026',
      '16:30',
      'https://meet.google.com/valid-demo',
      'tallykonnect-google',
      'tallykonnect'
    );
  });

  it('sends automatic retries with EmailDelivery.senderAccountKey', async () => {
    emailDeliveryMock.listDueEmailRetries.mockResolvedValue([
      {
        id: 'retry-awt',
        eventKey: 'event-1',
        automationId: 'lead_123',
        demoSessionId: 'session-retry-awt',
        emailBrand: 'anywheretally',
        senderAccountKey: 'anywheretally-google',
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

    expect(workflowActivityMock.withWorkflowActivity).toHaveBeenCalledWith(
      'email-retry',
      'anywheretally',
      expect.any(Function)
    );
    expect(emailDeliveryMock.claimEmailRetryById).toHaveBeenCalledWith('retry-awt');
    expect(sendGmailTemplateMock).toHaveBeenCalledWith(
      'moh@example.com',
      {
        subject: 'Retry',
        text: 'Retry text',
        html: '<p>Retry</p>'
      },
      'anywheretally-google'
    );
    expect(markOutcomeEmailSentMock).toHaveBeenCalledWith('session-retry-awt', 'Demo Done');
  });

  it('does not mark a provider-sent retry failed when outcome metadata update fails', async () => {
    emailDeliveryMock.listDueEmailRetries.mockResolvedValue([
      {
        id: 'retry-metadata',
        eventKey: 'event-metadata',
        automationId: 'lead_123',
        demoSessionId: 'session-retry-metadata',
        emailBrand: 'anywheretally',
        senderAccountKey: 'anywheretally-google',
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
    markOutcomeEmailSentMock.mockRejectedValueOnce(new Error('history timestamp failed'));

    await runEmailRetryScanner();

    expect(sendGmailTemplateMock).toHaveBeenCalled();
    expect(emailDeliveryMock.markEmailDeliverySent).toHaveBeenCalledWith({
      deliveryId: 'retry-metadata',
      providerMessageId: 'gmail-retry-1'
    });
    expect(emailDeliveryMock.reconcileOutcomeEmailMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'retry-metadata',
        demoSessionId: 'session-retry-metadata'
      })
    );
    expect(emailDeliveryMock.markEmailDeliveryFailed).not.toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: 'retry-metadata' })
    );
  });

  it('does not send automatic retries while the delivery brand is resetting', async () => {
    workflowActivityMock.withWorkflowActivity.mockImplementationOnce(() => {
      throw new Error(workflowActivityMock.WORKFLOW_BUSY_RESET_MESSAGE);
    });
    emailDeliveryMock.listDueEmailRetries.mockResolvedValue([
      {
        id: 'retry-resetting',
        eventKey: 'event-resetting',
        automationId: 'lead_resetting',
        emailBrand: 'anywheretally',
        senderAccountKey: 'anywheretally-google',
        emailType: 'DEMO_DONE',
        recipient: 'resetting@example.com',
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

    expect(emailDeliveryMock.claimEmailRetryById).not.toHaveBeenCalled();
    expect(sendGmailTemplateMock).not.toHaveBeenCalled();
  });

  it('does not finalize if a claimed retry disappears before completion', async () => {
    emailDeliveryMock.claimEmailRetryById.mockResolvedValue(true);
    emailDeliveryMock.findEmailDeliveryById.mockResolvedValue(null);
    emailDeliveryMock.listDueEmailRetries.mockResolvedValue([
      {
        id: 'retry-deleted',
        eventKey: 'event-deleted',
        automationId: 'lead_deleted',
        emailBrand: 'anywheretally',
        senderAccountKey: 'anywheretally-google',
        emailType: 'DEMO_DONE',
        recipient: 'deleted@example.com',
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

    expect(sendGmailTemplateMock).toHaveBeenCalled();
    expect(emailDeliveryMock.markEmailDeliverySent).not.toHaveBeenCalled();
  });

  it('fails an invalid retry sender without stopping the next due retry', async () => {
    emailDeliveryMock.listDueEmailRetries.mockResolvedValue([
      {
        id: 'retry-invalid',
        eventKey: 'event-invalid',
        automationId: 'lead_invalid',
        emailBrand: 'anywheretally',
        senderAccountKey: 'broken-sender',
        emailType: 'DEMO_DONE',
        recipient: 'invalid@example.com',
        payloadHash: 'payload-invalid',
        subject: 'Retry invalid',
        textBody: 'Retry text',
        htmlBody: '<p>Retry</p>',
        attemptCount: 1,
        retryCount: 1,
        maxRetries: 3,
        nextRetryAt: new Date()
      },
      {
        id: 'retry-valid',
        eventKey: 'event-valid',
        automationId: 'lead_valid',
        emailBrand: 'anywheretally',
        senderAccountKey: 'tallykonnect-google',
        emailType: 'DEMO_DONE',
        recipient: 'valid-retry@example.com',
        payloadHash: 'payload-valid',
        subject: 'Retry valid',
        textBody: 'Retry text',
        htmlBody: '<p>Retry</p>',
        attemptCount: 1,
        retryCount: 1,
        maxRetries: 3,
        nextRetryAt: new Date()
      }
    ]);

    await runEmailRetryScanner();

    expect(sendGmailTemplateMock).toHaveBeenCalledTimes(1);
    expect(sendGmailTemplateMock).toHaveBeenCalledWith(
      'valid-retry@example.com',
      {
        subject: 'Retry valid',
        text: 'Retry text',
        html: '<p>Retry</p>'
      },
      'tallykonnect-google'
    );
    expect(emailDeliveryMock.markEmailDeliveryFailed).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: 'retry-invalid' })
    );
  });

  it('does not retry when stored email payload is missing', async () => {
    emailDeliveryMock.listDueEmailRetries.mockResolvedValue([
      {
        id: 'retry-missing-payload',
        eventKey: 'event-missing',
        automationId: 'lead_missing',
        emailBrand: 'tallykonnect',
        senderAccountKey: 'tallykonnect-google',
        emailType: 'DEMO_DONE',
        recipient: 'missing@example.com',
        payloadHash: 'payload-missing',
        subject: null,
        textBody: 'Retry text',
        htmlBody: '<p>Retry</p>',
        attemptCount: 1,
        retryCount: 1,
        maxRetries: 3,
        nextRetryAt: new Date()
      }
    ]);

    await runEmailRetryScanner();

    expect(emailDeliveryMock.claimEmailRetryById).not.toHaveBeenCalled();
    expect(sendGmailTemplateMock).not.toHaveBeenCalled();
    expect(emailDeliveryMock.markEmailDeliveryFailed).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: 'retry-missing-payload' })
    );
  });

  it('does not send Gmail when another worker already claimed the retry', async () => {
    emailDeliveryMock.claimEmailRetryById.mockResolvedValue(false);
    emailDeliveryMock.listDueEmailRetries.mockResolvedValue([
      {
        id: 'retry-claimed',
        eventKey: 'event-claimed',
        automationId: 'lead_claimed',
        emailBrand: 'tallykonnect',
        senderAccountKey: 'tallykonnect-google',
        emailType: 'DEMO_DONE',
        recipient: 'claimed@example.com',
        payloadHash: 'payload-claimed',
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

    expect(sendGmailTemplateMock).not.toHaveBeenCalled();
    expect(emailDeliveryMock.markEmailDeliverySent).not.toHaveBeenCalled();
  });

  it('manual retry route uses persisted delivery sender account', () => {
    const routeSource = fs.readFileSync(path.join(process.cwd(), 'server', 'routes', 'leadRoutes.ts'), 'utf-8');

    expect(routeSource).toContain('sendGmailTemplate(delivery.recipient');
    expect(routeSource).toContain('const senderAccountKey = parseSenderAccountKey(delivery.senderAccountKey)');
    expect(routeSource).toContain('}, senderAccountKey)');
  });
});
