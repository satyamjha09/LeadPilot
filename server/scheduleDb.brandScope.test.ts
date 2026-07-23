import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ExcelRow } from '../src/types';

const prismaMock = vi.hoisted(() => ({
  customerDemoState: {
    findUnique: vi.fn(),
    update: vi.fn()
  },
  demoHistory: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn()
  },
  leadSchedule: {
    findFirst: vi.fn(),
    updateMany: vi.fn()
  },
  sheetLeadState: {
    findUnique: vi.fn()
  },
  $transaction: vi.fn()
}));

vi.mock('./db', () => ({
  prisma: prismaMock
}));

const {
  assertDemoBrandOwnership,
  assertDemoLifecycleOwnership,
  applyDbTruthToRows,
  findLeadSchedule,
  getCustomerDemoState,
  getSheetLeadState
} = await import('./scheduleDb');

const baseRow: ExcelRow = {
  id: 'row-1',
  full_name: 'Moh Agarwal',
  email: 'moh@example.com',
  automation_id: 'lead_123',
  'Date of Demo': '15-06-2026',
  'Time of Demo': '15:30',
  lead_status: 'Demo Scheduled',
  __sourceType: 'google-sheet',
  __spreadsheetId: 'sheet_1',
  __sheetName: 'Leads',
  __sheetRowNumber: 2
};

describe('brand-scoped schedule state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.customerDemoState.findUnique.mockResolvedValue(null);
    prismaMock.leadSchedule.findFirst.mockResolvedValue(null);
    prismaMock.sheetLeadState.findUnique.mockResolvedValue(null);
  });

  it('looks up customer demo state by brand and userId', async () => {
    await getCustomerDemoState(baseRow, 'anywheretally');

    expect(prismaMock.customerDemoState.findUnique).toHaveBeenCalledWith({
      where: {
        emailBrand_userId: {
          emailBrand: 'anywheretally',
          userId: 'lead_123'
        }
      },
      include: { demoHistory: { orderBy: { createdAt: 'desc' } } }
    });
  });

  it('scopes LeadSchedule lookup to the selected brand', async () => {
    await findLeadSchedule(baseRow, 'tallykonnect');

    expect(prismaMock.leadSchedule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          emailBrand: 'tallykonnect'
        })
      })
    );
  });

  it('scopes SheetLeadState lookup to the selected brand', async () => {
    await getSheetLeadState(baseRow, 'anywheretally');

    expect(prismaMock.sheetLeadState.findUnique).toHaveBeenCalledWith({
      where: {
        emailBrand_sheetRowKey: {
          emailBrand: 'anywheretally',
          sheetRowKey: 'sheet_1|Leads|2'
        }
      }
    });
  });

  it('does not apply TallyKonnect schedule truth while reconciling AnyWhereTally', async () => {
    prismaMock.leadSchedule.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.emailBrand !== 'tallykonnect') return null;
      return {
        emailBrand: 'tallykonnect',
        senderAccountKey: 'tallykonnect-google',
        automationId: 'lead_123',
        fullName: 'Moh Agarwal',
        email: 'moh@example.com',
        dateOfDemo: '15-06-2026',
        timeOfDemo: '15:30',
        meetingLink: 'https://meet.google.com/tk-demo',
        status: 'Demo Scheduled',
        remarks: 'Already scheduled from database'
      };
    });

    const [anyWhereTallyRow] = await applyDbTruthToRows([baseRow], 'anywheretally');
    const [tallyKonnectRow] = await applyDbTruthToRows([baseRow], 'tallykonnect');

    expect(anyWhereTallyRow['Meeting Details']).toBeUndefined();
    expect(anyWhereTallyRow.__emailBrand).toBeUndefined();
    expect(tallyKonnectRow['Meeting Details']).toBe('https://meet.google.com/tk-demo');
    expect(tallyKonnectRow.__emailBrand).toBe('tallykonnect');
  });

  it('does not restore meeting links from terminal LeadSchedule rows', async () => {
    prismaMock.leadSchedule.findFirst.mockResolvedValue({
      emailBrand: 'anywheretally',
      senderAccountKey: 'anywheretally-google',
      demoSessionId: 'session-terminal',
      automationId: 'lead_123',
      fullName: 'Moh Agarwal',
      email: 'moh@example.com',
      dateOfDemo: '15-06-2026',
      timeOfDemo: '15:30',
      meetingLink: 'https://meet.google.com/old-terminal',
      status: 'Demo Done',
      remarks: 'Demo completed.'
    });

    const [row] = await applyDbTruthToRows([baseRow], 'anywheretally');

    expect(row['Meeting Details']).toBe('');
    expect(row.__dbFinalState).toBe(true);
    expect(row.__demoSessionId).toBe('session-terminal');
  });

  it('blocks a new Demo Scheduled slot when an active demo already exists', async () => {
    prismaMock.customerDemoState.findUnique.mockResolvedValue({
      emailBrand: 'anywheretally',
      senderAccountKey: 'anywheretally-google',
      userId: 'lead_123',
      email: 'moh@example.com',
      status: 'Demo Scheduled',
      activeDemoSessionId: 'session-active',
      meetingLink: 'https://meet.google.com/active',
      calendarEventId: 'calendar-active',
      demoDate: '15-06-2026',
      demoTime: '16:30',
      demoStartUtc: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    prismaMock.demoHistory.findUnique.mockResolvedValue({
      sessionId: 'session-active',
      senderAccountKey: 'anywheretally-google',
      status: 'Demo Scheduled'
    });

    const [row] = await applyDbTruthToRows([baseRow], 'anywheretally');

    expect(row.__schedulerStatus).toBe('Failed');
    expect(row.Remarks).toBe('This customer already has an active demo. Use Reschedule.');
  });

  it('throws a brand mismatch when another brand owns the active demo', async () => {
    prismaMock.customerDemoState.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.emailBrand_userId.emailBrand !== 'tallykonnect') return null;
      return {
        emailBrand: 'tallykonnect',
        senderAccountKey: 'tallykonnect-google',
        userId: 'lead_123',
        email: 'moh@example.com',
        status: 'Demo Scheduled',
        activeDemoSessionId: 'session-tk',
        meetingLink: 'https://meet.google.com/tk-demo',
        calendarEventId: 'calendar-tk',
        demoDate: '15-06-2026',
        demoTime: '15:30',
        demoStartUtc: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      };
    });
    prismaMock.demoHistory.findUnique.mockResolvedValue({
      sessionId: 'session-tk',
      senderAccountKey: 'tallykonnect-google',
      status: 'Demo Scheduled'
    });

    await expect(assertDemoBrandOwnership(baseRow, 'anywheretally')).rejects.toMatchObject({
      code: 'EMAIL_BRAND_MISMATCH',
      statusCode: 409,
      requiredBrand: 'tallykonnect',
      selectedBrand: 'anywheretally'
    });
  });

  it('allows a cross-combination lifecycle owner and rejects the wrong sender', async () => {
    prismaMock.customerDemoState.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.emailBrand_userId.emailBrand !== 'anywheretally') return null;
      return {
        emailBrand: 'anywheretally',
        senderAccountKey: 'tallykonnect-google',
        userId: 'lead_123',
        email: 'moh@example.com',
        status: 'Demo Scheduled',
        activeDemoSessionId: 'session-cross',
        meetingLink: 'https://meet.google.com/cross-demo',
        calendarEventId: 'calendar-cross',
        demoDate: '15-06-2026',
        demoTime: '15:30',
        demoStartUtc: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      };
    });
    prismaMock.demoHistory.findUnique.mockResolvedValue({
      sessionId: 'session-cross',
      senderAccountKey: 'tallykonnect-google',
      status: 'Demo Scheduled'
    });

    const owner = await assertDemoLifecycleOwnership(baseRow, 'anywheretally', 'tallykonnect-google');

    expect(owner.emailBrand).toBe('anywheretally');
    expect(owner.senderAccountKey).toBe('tallykonnect-google');
    await expect(
      assertDemoLifecycleOwnership(baseRow, 'anywheretally', 'anywheretally-google')
    ).rejects.toMatchObject({
      code: 'SENDER_ACCOUNT_MISMATCH',
      statusCode: 409,
      requiredSenderAccountKey: 'tallykonnect-google',
      selectedSenderAccountKey: 'anywheretally-google'
    });
  });

  it('makes lifecycle sender ownership required in the Prisma schema', () => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf-8');
    const modelBody = (name: string) => {
      const start = schema.indexOf(`model ${name}`);
      const end = schema.indexOf('\nmodel ', start + 1);
      expect(start).toBeGreaterThanOrEqual(0);
      return schema.slice(start, end > start ? end : schema.length);
    };

    expect(modelBody('LeadSchedule')).toContain('senderAccountKey String');
    expect(modelBody('CustomerDemoState')).toContain('senderAccountKey    String');
    expect(modelBody('DemoHistory')).toContain('senderAccountKey        String');
    expect(modelBody('ProcessLeadJob')).toContain('senderAccountKey String');
  });

  it('defines DemoHistory relation through the brand-specific customer state', () => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf-8');

    expect(schema).toContain(
      'customer CustomerDemoState @relation(fields: [emailBrand, userId], references: [emailBrand, userId])'
    );
    expect(schema).toContain('@@unique([emailBrand, userId])');
  });
});
