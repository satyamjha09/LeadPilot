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

  it('throws a brand mismatch when another brand owns the active demo', async () => {
    prismaMock.customerDemoState.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.emailBrand_userId.emailBrand !== 'tallykonnect') return null;
      return {
        emailBrand: 'tallykonnect',
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
      status: 'Demo Scheduled'
    });

    await expect(assertDemoBrandOwnership(baseRow, 'anywheretally')).rejects.toMatchObject({
      code: 'EMAIL_BRAND_MISMATCH',
      statusCode: 409,
      requiredBrand: 'tallykonnect',
      selectedBrand: 'anywheretally'
    });
  });

  it('defines DemoHistory relation through the brand-specific customer state', () => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf-8');

    expect(schema).toContain(
      'customer CustomerDemoState @relation(fields: [emailBrand, userId], references: [emailBrand, userId])'
    );
    expect(schema).toContain('@@unique([emailBrand, userId])');
  });
});
