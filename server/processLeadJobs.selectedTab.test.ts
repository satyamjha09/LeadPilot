import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  processLeadJob: {
    create: vi.fn(),
    findUnique: vi.fn()
  }
}));

vi.mock('./db', () => ({
  prisma: prismaMock
}));

vi.mock('./workflowControl', () => ({
  getWorkflowGenerationForNewJob: vi.fn(async () => 12)
}));

const { createProcessLeadJob, serializeProcessLeadJob } = await import('./processLeadJobs');

describe('selected-tab process job ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.processLeadJob.create.mockImplementation(async ({ data }) => ({
      id: 'job-1',
      ...data,
      createdAt: new Date('2026-07-22T00:00:00.000Z'),
      updatedAt: new Date('2026-07-22T00:00:00.000Z')
    }));
  });

  it('persists workspace, source tab, snapshot, email brand, sender and Google Sheet account independently', async () => {
    const job = await createProcessLeadJob({
      sourceType: 'google-sheet',
      workspaceKey: 'tallykonnect',
      emailBrandKey: 'anywheretally',
      emailBrand: 'anywheretally',
      senderAccountKey: 'tallykonnect-google',
      googleAccountKey: 'tallykonnect-google',
      sourceId: 'source-1',
      sourceTabId: 'tab-2',
      sourceSnapshotId: 'snapshot-2',
      sourceRowIds: ['row-2'],
      spreadsheetId: 'spreadsheet-1',
      sheetName: 'Sheet 2',
      headers: ['email', 'lead_status'],
      rows: [{ id: 'row-2', email: 'sheet2@example.com', __sourceRowId: 'row-2' }]
    });

    expect(prismaMock.processLeadJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceKey: 'tallykonnect',
        emailBrand: 'anywheretally',
        emailBrandKey: 'anywheretally',
        senderAccountKey: 'tallykonnect-google',
        googleAccountKey: 'tallykonnect-google',
        dataSourceId: 'source-1',
        sourceTabId: 'tab-2',
        sourceSnapshotId: 'snapshot-2',
        sourceRowIdsJson: JSON.stringify(['row-2'])
      })
    });

    const serialized = serializeProcessLeadJob(job as any);
    expect(serialized).toMatchObject({
      workspaceKey: 'tallykonnect',
      emailBrand: 'anywheretally',
      senderAccountKey: 'tallykonnect-google',
      googleAccountKey: 'tallykonnect-google',
      sourceId: 'source-1',
      sourceTabId: 'tab-2',
      sourceSnapshotId: 'snapshot-2',
      sourceScope: {
        workspaceKey: 'tallykonnect',
        sourceId: 'source-1',
        sourceTabId: 'tab-2',
        sourceSnapshotId: 'snapshot-2',
        sourceType: 'google-sheet',
        googleAccountKey: 'tallykonnect-google'
      }
    });
  });
});
