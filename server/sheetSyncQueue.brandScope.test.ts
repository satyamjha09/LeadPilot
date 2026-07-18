import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn()
}));

vi.mock('./db', () => ({
  prisma: prismaMock
}));

const { enqueueSheetSyncJob, listSheetSyncJobsForRow } = await import('./sheetSyncQueue');

describe('brand-scoped Google Sheet retry queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$executeRaw.mockResolvedValue(1);
    prismaMock.$queryRaw.mockResolvedValue([]);
  });

  it('upserts SheetSyncJob records with the composite brand and row-job conflict key', async () => {
    await enqueueSheetSyncJob({
      emailBrand: 'anywheretally',
      spreadsheetId: 'sheet-1',
      sheetName: 'Leads',
      rowNumber: 2,
      headers: ['lead_status'],
      values: { lead_status: 'Demo Scheduled' },
      error: new Error('Google rejected the update')
    });

    const rawSql = prismaMock.$executeRaw.mock.calls[0][0].join('');
    expect(rawSql).toContain('ON CONFLICT ("emailBrand", "jobKey") DO UPDATE SET');
    expect(rawSql).toContain('"emailBrand"');
    expect(prismaMock.$executeRaw.mock.calls[0]).toContain('anywheretally');
  });

  it('allows the same Sheet row to have independent retry jobs per brand', async () => {
    const sharedRow = {
      spreadsheetId: 'sheet-1',
      sheetName: 'Leads',
      rowNumber: 7,
      headers: ['Meeting Details'],
      values: { 'Meeting Details': 'https://meet.google.com/shared' },
      error: new Error('temporary failure')
    };

    await enqueueSheetSyncJob({ ...sharedRow, emailBrand: 'tallykonnect' });
    await enqueueSheetSyncJob({ ...sharedRow, emailBrand: 'anywheretally' });

    const firstCall = prismaMock.$executeRaw.mock.calls[0];
    const secondCall = prismaMock.$executeRaw.mock.calls[1];

    expect(firstCall).toContain('tallykonnect');
    expect(secondCall).toContain('anywheretally');
    expect(firstCall).toContain('sheet-1|Leads|7');
    expect(secondCall).toContain('sheet-1|Leads|7');
    expect(firstCall[3]).not.toBe(secondCall[3]);
  });

  it('filters row retry history by selected brand', async () => {
    await listSheetSyncJobsForRow({
      emailBrand: 'anywheretally',
      spreadsheetId: 'sheet-1',
      sheetName: 'Leads',
      rowNumber: 2
    });

    const rawSql = prismaMock.$queryRaw.mock.calls[0][0].join('');
    expect(rawSql).toContain('WHERE "emailBrand" =');
    expect(rawSql).toContain('AND "spreadsheetId" =');
    expect(prismaMock.$queryRaw.mock.calls[0]).toContain('anywheretally');
  });
});
