import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ExcelRow } from '../src/types';
import { EMAIL_TYPES } from './emailIdentity';
import type { EmailClaimInput } from './emailDelivery';

const prismaMock = vi.hoisted(() => ({
  emailDelivery: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn()
  },
  $executeRaw: vi.fn()
}));

vi.mock('./db', () => ({
  prisma: prismaMock
}));

const {
  claimEmailDelivery,
  claimEmailRetryById,
  createPendingEmailDeliveryIntent,
  findEmailDeliveryByEventKey,
  listEmailDeliveriesForRow
} = await import('./emailDelivery');

const baseRow: ExcelRow = {
  id: 'row-1',
  full_name: 'Moh Agarwal',
  email: 'moh@example.com',
  automation_id: 'lead_123',
  'Date of Demo': '15-06-2026',
  'Time of Demo': '15:30'
};

describe('brand-scoped email delivery idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.emailDelivery.findUnique.mockResolvedValue(null);
    prismaMock.emailDelivery.findMany.mockResolvedValue([]);
    prismaMock.$executeRaw.mockResolvedValue(1);
  });

  it('looks up delivery state by brand and event key', async () => {
    await findEmailDeliveryByEventKey('anywheretally', 'same-event-key');

    expect(prismaMock.emailDelivery.findUnique).toHaveBeenCalledWith({
      where: {
        emailBrand_eventKey: {
          emailBrand: 'anywheretally',
          eventKey: 'same-event-key'
        }
      }
    });
  });

  it('does not let a TallyKonnect sent event block AnyWhereTally', async () => {
    prismaMock.emailDelivery.findUnique.mockImplementation(async ({ where }: any) => {
      const selector = where.emailBrand_eventKey;
      if (selector.emailBrand === 'tallykonnect') {
        return {
          id: 'delivery-tk',
          status: 'SENT',
          providerMessageId: 'gmail-tk'
        };
      }
      return null;
    });

    const tallyKonnectClaim = await claimEmailDelivery({
      emailBrand: 'tallykonnect',
      eventKey: 'same-event-key',
      automationId: 'lead_123',
      emailType: EMAIL_TYPES.DEMO_SCHEDULED,
      recipient: 'moh@example.com',
      senderAccountKey: 'tallykonnect-google',
      payloadHash: 'hash'
    });
    const anyWhereTallyClaim = await claimEmailDelivery({
      emailBrand: 'anywheretally',
      eventKey: 'same-event-key',
      automationId: 'lead_123',
      emailType: EMAIL_TYPES.DEMO_SCHEDULED,
      recipient: 'moh@example.com',
      senderAccountKey: 'anywheretally-google',
      payloadHash: 'hash'
    });

    expect(tallyKonnectClaim).toMatchObject({
      claimed: false,
      reason: 'ALREADY_SENT',
      providerMessageId: 'gmail-tk'
    });
    expect(anyWhereTallyClaim).toMatchObject({
      claimed: true
    });
  });

  it('uses the composite database conflict key when claiming a delivery', async () => {
    await claimEmailDelivery({
      emailBrand: 'anywheretally',
      eventKey: 'same-event-key',
      automationId: 'lead_123',
      emailType: EMAIL_TYPES.DEMO_SCHEDULED,
      recipient: 'moh@example.com',
      senderAccountKey: 'tallykonnect-google',
      payloadHash: 'hash'
    });

    const rawSql = prismaMock.$executeRaw.mock.calls[0][0].join('');
    expect(rawSql).toContain('ON CONFLICT ("emailBrand", "eventKey") DO NOTHING');
  });

  it('persists email brand and sender account independently for cross-combinations', async () => {
    await claimEmailDelivery({
      emailBrand: 'anywheretally',
      senderAccountKey: 'tallykonnect-google',
      eventKey: 'cross-combo-event',
      automationId: 'lead_456',
      demoSessionId: 'session_cross',
      emailType: EMAIL_TYPES.DEMO_DONE,
      recipient: 'sai@example.com',
      payloadHash: 'hash-cross'
    });

    expect(prismaMock.$executeRaw.mock.calls[0]).toEqual(
      expect.arrayContaining(['anywheretally', 'tallykonnect-google', 'session_cross'])
    );
  });

  it('creates pending terminal email intents with session ownership before send', async () => {
    const intent = await createPendingEmailDeliveryIntent({
      emailBrand: 'anywheretally',
      senderAccountKey: 'tallykonnect-google',
      eventKey: 'session-done-event',
      automationId: 'lead_456',
      demoSessionId: 'session_done_1',
      emailType: EMAIL_TYPES.DEMO_DONE,
      recipient: 'sai@example.com',
      payloadHash: 'hash-pending',
      subject: 'Thanks',
      text: 'Thanks',
      html: '<p>Thanks</p>'
    });

    expect(intent).toMatchObject({ created: true, status: 'PENDING' });
    expect(prismaMock.$executeRaw.mock.calls[0]).toEqual(
      expect.arrayContaining(['PENDING', 0, 'session_done_1'])
    );
  });

  it('lets retry claiming pick up PENDING email intents', async () => {
    prismaMock.emailDelivery.updateMany.mockResolvedValue({ count: 1 });

    await expect(claimEmailRetryById('delivery-pending')).resolves.toBe(true);

    expect(prismaMock.emailDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: 'delivery-pending', status: { in: ['PENDING', 'RETRY_PENDING'] } },
      data: expect.objectContaining({
        status: 'PROCESSING',
        nextRetryAt: null
      })
    });
  });

  it('rejects a missing senderAccountKey before database insert', async () => {
    // @ts-expect-error senderAccountKey is intentionally required by EmailClaimInput.
    const missingSenderInput: EmailClaimInput = {
      emailBrand: 'anywheretally',
      eventKey: 'missing-sender-event',
      automationId: 'lead_789',
      emailType: EMAIL_TYPES.DEMO_DONE,
      recipient: 'no-sender@example.com',
      payloadHash: 'hash-missing'
    };

    await expect(claimEmailDelivery(missingSenderInput as any)).rejects.toThrow('senderAccountKey is required');

    expect(prismaMock.emailDelivery.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });

  it('filters row delivery history by selected brand and automation id', async () => {
    await listEmailDeliveriesForRow(baseRow, {
      sourceType: 'excel',
      emailBrand: 'anywheretally'
    });

    expect(prismaMock.emailDelivery.findMany).toHaveBeenCalledWith({
      where: {
        emailBrand: 'anywheretally',
        automationId: 'lead_123'
      },
      orderBy: { createdAt: 'desc' }
    });
  });

  it('declares composite email delivery uniqueness in Prisma schema', () => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf-8');

    expect(schema).toContain('@@unique([emailBrand, eventKey])');
    expect(schema).not.toContain('eventKey          String   @unique');
  });
});
