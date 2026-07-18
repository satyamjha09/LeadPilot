import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ExcelRow } from '../src/types';
import { EMAIL_TYPES } from './emailIdentity';

const prismaMock = vi.hoisted(() => ({
  emailDelivery: {
    findUnique: vi.fn(),
    findMany: vi.fn()
  },
  $executeRaw: vi.fn()
}));

vi.mock('./db', () => ({
  prisma: prismaMock
}));

const {
  claimEmailDelivery,
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
      payloadHash: 'hash'
    });
    const anyWhereTallyClaim = await claimEmailDelivery({
      emailBrand: 'anywheretally',
      eventKey: 'same-event-key',
      automationId: 'lead_123',
      emailType: EMAIL_TYPES.DEMO_SCHEDULED,
      recipient: 'moh@example.com',
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
      payloadHash: 'hash'
    });

    const rawSql = prismaMock.$executeRaw.mock.calls[0][0].join('');
    expect(rawSql).toContain('ON CONFLICT ("emailBrand", "eventKey") DO NOTHING');
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
