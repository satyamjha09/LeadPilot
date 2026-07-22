import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  leadSchedule: {
    findMany: vi.fn()
  },
  emailDelivery: {
    findMany: vi.fn(),
    count: vi.fn()
  },
  sheetSyncJob: {
    findMany: vi.fn(),
    count: vi.fn()
  },
  processLeadJob: {
    findMany: vi.fn(),
    count: vi.fn()
  }
}));

vi.mock('./db', () => ({
  prisma: prismaMock
}));

const {
  clampActivityLimit,
  clampTrendDays,
  getDashboardActivity,
  getDashboardHealth,
  getScheduledLeadTrend,
  parseDashboardEmailBrandScope
} = await import('./dashboardService');

describe('dashboard email-brand isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.leadSchedule.findMany.mockResolvedValue([]);
    prismaMock.emailDelivery.findMany.mockResolvedValue([]);
    prismaMock.sheetSyncJob.findMany.mockResolvedValue([]);
    prismaMock.processLeadJob.findMany.mockResolvedValue([]);
    prismaMock.emailDelivery.count.mockResolvedValue(0);
    prismaMock.sheetSyncJob.count.mockResolvedValue(0);
    prismaMock.processLeadJob.count.mockResolvedValue(0);
  });

  it('requires an explicit emailBrand scope and never treats workspaceKey as a silent fallback', () => {
    expect(() => parseDashboardEmailBrandScope(undefined)).toThrow(/emailBrand must be/);
    expect(() => parseDashboardEmailBrandScope('tallykonnect-workspace')).toThrow(/emailBrand must be/);
    expect(parseDashboardEmailBrandScope(undefined, 'anywheretally')).toBe('anywheretally');
    expect(prismaMock.leadSchedule.findMany).not.toHaveBeenCalled();
    expect(prismaMock.emailDelivery.count).not.toHaveBeenCalled();
  });

  it('counts scheduled leads by emailBrand, successful meeting ownership, and IST day boundaries', async () => {
    prismaMock.leadSchedule.findMany.mockResolvedValue([
      { createdAt: new Date('2026-07-20T18:30:00.000Z') },
      { createdAt: new Date('2026-07-21T18:29:59.000Z') },
      { createdAt: new Date('2026-07-21T18:30:00.000Z') }
    ]);

    const data = await getScheduledLeadTrend('anywheretally', 3, new Date('2026-07-21T18:31:00.000Z'));

    expect(prismaMock.leadSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          emailBrand: 'anywheretally',
          status: { not: 'Failed' },
          AND: expect.arrayContaining([
            { meetingLink: { not: null } },
            { meetingLink: { not: '' } },
            { calendarEventId: { not: null } },
            { calendarEventId: { not: '' } }
          ])
        })
      })
    );
    expect(data).toEqual([
      { date: 'Jul 20', count: 0 },
      { date: 'Jul 21', count: 2 },
      { date: 'Jul 22', count: 1 }
    ]);
  });

  it('clamps trend days and returns zero-valued empty buckets in oldest-to-newest order', async () => {
    const days = clampTrendDays(1000);
    const data = await getScheduledLeadTrend('tallykonnect', days, new Date('2026-07-22T05:00:00.000Z'));

    expect(days).toBe(31);
    expect(data).toHaveLength(31);
    expect(data.at(0)?.count).toBe(0);
    expect(data.at(-1)?.count).toBe(0);
  });

  it('merges activity from brand-scoped sources, sorts by event time, and applies the global limit after merging', async () => {
    prismaMock.leadSchedule.findMany.mockResolvedValue([
      {
        id: 'schedule-old',
        emailBrand: 'anywheretally',
        senderAccountKey: 'tallykonnect-google',
        fullName: 'Same Lead',
        email: 'same@example.com',
        status: 'Demo Scheduled',
        remarks: '',
        dateOfDemo: '22-07-2026',
        timeOfDemo: '10:00',
        updatedAt: new Date('2026-07-22T05:00:00.000Z')
      }
    ]);
    prismaMock.emailDelivery.findMany.mockResolvedValue([
      {
        id: 'delivery-new',
        emailBrand: 'anywheretally',
        senderAccountKey: 'tallykonnect-google',
        emailType: 'demo_scheduled',
        recipient: 'same@example.com',
        status: 'SENT',
        subject: 'AnyWhereTally invite',
        lastError: null,
        sentAt: new Date('2026-07-22T05:03:00.000Z'),
        updatedAt: new Date('2026-07-22T05:03:00.000Z')
      }
    ]);
    prismaMock.sheetSyncJob.findMany.mockResolvedValue([
      {
        id: 'sheet-cross',
        emailBrand: 'anywheretally',
        workspaceKey: 'tallykonnect',
        googleAccountKey: 'tallykonnect-google',
        status: 'FAILED',
        sheetName: 'Leads',
        rowNumber: 2,
        lastError: 'permission denied',
        updatedAt: new Date('2026-07-22T05:02:00.000Z')
      }
    ]);
    prismaMock.processLeadJob.findMany.mockResolvedValue([
      {
        id: 'process-middle',
        emailBrand: 'anywheretally',
        workspaceKey: 'tallykonnect',
        senderAccountKey: 'tallykonnect-google',
        status: 'RUNNING',
        sourceType: 'google-sheet',
        error: null,
        updatedAt: new Date('2026-07-22T05:01:00.000Z')
      }
    ]);

    const data = await getDashboardActivity('anywheretally', 3);

    expect(prismaMock.leadSchedule.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { emailBrand: 'anywheretally' } }));
    expect(prismaMock.emailDelivery.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { emailBrand: 'anywheretally' } }));
    expect(prismaMock.sheetSyncJob.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { emailBrand: 'anywheretally' } }));
    expect(prismaMock.processLeadJob.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { emailBrand: 'anywheretally' } }));
    expect(data.map((event) => event.id)).toEqual([
      'email-delivery:delivery-new',
      'sheet-sync:sheet-cross',
      'process-job:process-middle'
    ]);
    expect(data[1]).toMatchObject({
      emailBrand: 'anywheretally',
      workspaceKey: 'tallykonnect',
      googleAccountKey: 'tallykonnect-google',
      tone: 'failed'
    });
  });

  it('scopes health counts by emailBrand instead of workspaceKey or senderAccountKey', async () => {
    prismaMock.emailDelivery.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4);
    prismaMock.sheetSyncJob.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(7);
    prismaMock.processLeadJob.count
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(9);

    const data = await getDashboardHealth('anywheretally');

    expect(prismaMock.emailDelivery.count.mock.calls.every(([arg]) => arg.where.emailBrand === 'anywheretally')).toBe(true);
    expect(prismaMock.sheetSyncJob.count.mock.calls.every(([arg]) => arg.where.emailBrand === 'anywheretally')).toBe(true);
    expect(prismaMock.processLeadJob.count.mock.calls.every(([arg]) => arg.where.emailBrand === 'anywheretally')).toBe(true);
    expect(data).toMatchObject({
      emailFailures: 1,
      emailUnknown: 2,
      emailRetryPending: 3,
      emailProcessingStale: 4,
      sheetSyncFailed: 5,
      sheetSyncPending: 6,
      sheetSyncProcessingStale: 7,
      failedProcessJobs: 8,
      activeProcessJobs: 9,
      issueCount: 36,
      warningCount: 9
    });
  });

  it('keeps the activity limit within the configured ceiling', () => {
    expect(clampActivityLimit(1000)).toBe(50);
    expect(clampActivityLimit(0)).toBe(1);
  });
});
