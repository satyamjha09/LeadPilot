import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn()
}));

vi.mock('./db', () => ({
  prisma: prismaMock
}));

const {
  claimSheetSyncJobForProcessing,
  enqueueSheetSyncJob,
  listSheetSyncJobsForRow,
  markSheetSyncJobFailed,
  markSheetSyncJobSucceeded
} = await import('./sheetSyncQueue');

describe('workspace-owned Google Sheet retry queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$executeRaw.mockResolvedValue(1);
    prismaMock.$queryRaw.mockResolvedValue([]);
  });

  it('upserts SheetSyncJob records with separate workspace, email brand, and Google account ownership', async () => {
    await enqueueSheetSyncJob({
      workspaceKey: 'tallykonnect',
      emailBrand: 'anywheretally',
      googleAccountKey: 'tallykonnect-google',
      spreadsheetId: 'sheet-1',
      sheetName: 'Leads',
      rowNumber: 2,
      headers: ['lead_status'],
      values: { lead_status: 'Demo Scheduled' },
      error: new Error('Google rejected the update')
    });

    const rawSql = prismaMock.$executeRaw.mock.calls[0][0].join('');
    const values = prismaMock.$executeRaw.mock.calls[0];
    expect(rawSql).toContain('ON CONFLICT ("workspaceKey", "emailBrand", "jobKey") DO UPDATE SET');
    expect(rawSql).toContain('"workspaceKey"');
    expect(rawSql).toContain('"emailBrand"');
    expect(rawSql).toContain('"googleAccountKey"');
    expect(values).toContain('tallykonnect');
    expect(values).toContain('anywheretally');
    expect(values).toContain('tallykonnect-google');
  });

  it('allows the same Sheet row to have independent retry jobs per workspace and brand pair', async () => {
    const sharedRow = {
      spreadsheetId: 'sheet-1',
      sheetName: 'Leads',
      rowNumber: 7,
      headers: ['Meeting Details'],
      values: { 'Meeting Details': 'https://meet.google.com/shared' },
      error: new Error('temporary failure')
    };

    await enqueueSheetSyncJob({
      ...sharedRow,
      workspaceKey: 'tallykonnect',
      emailBrand: 'anywheretally',
      googleAccountKey: 'tallykonnect-google'
    });
    await enqueueSheetSyncJob({
      ...sharedRow,
      workspaceKey: 'anywheretally',
      emailBrand: 'anywheretally',
      googleAccountKey: 'anywheretally-google'
    });

    const firstCall = prismaMock.$executeRaw.mock.calls[0];
    const secondCall = prismaMock.$executeRaw.mock.calls[1];

    expect(firstCall).toContain('tallykonnect');
    expect(firstCall).toContain('anywheretally');
    expect(firstCall).toContain('tallykonnect-google');
    expect(secondCall).toContain('anywheretally-google');
    expect(firstCall).toContain('sheet-1|Leads|7');
    expect(secondCall).toContain('sheet-1|Leads|7');
  });

  it('filters row retry history by workspace and selected email brand', async () => {
    await listSheetSyncJobsForRow({
      workspaceKey: 'tallykonnect',
      emailBrand: 'anywheretally',
      spreadsheetId: 'sheet-1',
      sheetName: 'Leads',
      rowNumber: 2
    });

    const rawSql = prismaMock.$queryRaw.mock.calls[0][0].join('');
    const values = prismaMock.$queryRaw.mock.calls[0];
    expect(rawSql).toContain('WHERE "workspaceKey" =');
    expect(rawSql).toContain('AND "emailBrand" =');
    expect(rawSql).toContain('AND "spreadsheetId" =');
    expect(values).toContain('tallykonnect');
    expect(values).toContain('anywheretally');
  });

  it('claims a job atomically before a retry worker can call Google Sheets', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: 'sheet-job-1' }]);

    const claimed = await claimSheetSyncJobForProcessing('sheet-job-1');

    const rawSql = prismaMock.$queryRaw.mock.calls[0][0].join('');
    expect(claimed).toBe(true);
    expect(rawSql).toContain('UPDATE "SheetSyncJob"');
    expect(rawSql).toContain('"status" = \'PROCESSING\'');
    expect(rawSql).toContain('RETURNING "id"');
  });

  it('clears job locks on success and schedules terminal failures without another retry time', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ retryCount: 3, maxRetries: 3 }]);

    await markSheetSyncJobSucceeded('sheet-job-1');
    await markSheetSyncJobFailed('sheet-job-2', new Error('still failing'));

    const successSql = prismaMock.$executeRaw.mock.calls[0][0].join('');
    const failedSql = prismaMock.$executeRaw.mock.calls[1][0].join('');
    expect(successSql).toContain('"lockedAt" = NULL');
    expect(successSql).toContain('"lockedBy" = NULL');
    expect(failedSql).toContain('"lockedAt" = NULL');
    expect(failedSql).toContain('"lockedBy" = NULL');
    expect(prismaMock.$executeRaw.mock.calls[1]).toContain('FAILED');
    expect(prismaMock.$executeRaw.mock.calls[1]).toContain(null);
  });
});
