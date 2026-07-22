import { beforeEach, describe, expect, it, vi } from 'vitest';

const sheetSyncQueueMock = vi.hoisted(() => ({
  claimSheetSyncJobForProcessing: vi.fn(),
  listDueSheetSyncJobs: vi.fn(),
  markSheetSyncJobFailed: vi.fn(),
  markSheetSyncJobSucceeded: vi.fn()
}));

vi.mock('./sheetSyncQueue', () => sheetSyncQueueMock);

const googleSheetsMock = vi.hoisted(() => ({
  updateGoogleSheetRowsResilient: vi.fn()
}));

vi.mock('./googleSheets', () => googleSheetsMock);

const emailDeliveryMock = vi.hoisted(() => ({
  findEmailDeliveryById: vi.fn(),
  markEmailSheetSyncFailed: vi.fn(),
  markEmailSheetSyncSucceeded: vi.fn()
}));

vi.mock('./emailDelivery', () => emailDeliveryMock);

vi.mock('./workflowActivity', () => ({
  withWorkflowActivity: (_type: string, _workspaceKey: string, action: () => unknown) => action(),
  WORKFLOW_BUSY_RESET_MESSAGE: 'A workflow is currently running. Wait for it to finish before resetting.'
}));

const { runSheetSyncScanner } = await import('./sheetSyncWorker');

function sheetSyncJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sheet-sync-1',
    workspaceKey: 'tallykonnect',
    emailBrand: 'anywheretally',
    googleAccountKey: 'tallykonnect-google',
    spreadsheetId: 'sheet-1',
    sheetName: 'Leads',
    rowNumber: 2,
    headersJson: JSON.stringify(['Meeting Details', 'lead_status']),
    valuesJson: JSON.stringify({
      'Meeting Details': 'https://meet.google.com/cross-brand',
      lead_status: 'Demo Scheduled'
    }),
    emailDeliveryId: 'delivery-1',
    retryCount: 1,
    maxRetries: 3,
    ...overrides
  };
}

describe('workspace-owned Google Sheet retry worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sheetSyncQueueMock.claimSheetSyncJobForProcessing.mockResolvedValue(true);
    sheetSyncQueueMock.markSheetSyncJobFailed.mockResolvedValue(undefined);
    sheetSyncQueueMock.markSheetSyncJobSucceeded.mockResolvedValue(undefined);
    emailDeliveryMock.findEmailDeliveryById.mockResolvedValue({
      id: 'delivery-1',
      emailBrand: 'anywheretally'
    });
    emailDeliveryMock.markEmailSheetSyncFailed.mockResolvedValue(undefined);
    emailDeliveryMock.markEmailSheetSyncSucceeded.mockResolvedValue(undefined);
    googleSheetsMock.updateGoogleSheetRowsResilient.mockResolvedValue([{ success: true }]);
  });

  it('uses the persisted Google account, not emailBrand, for cross-brand sheet retries', async () => {
    sheetSyncQueueMock.listDueSheetSyncJobs.mockResolvedValue([sheetSyncJob()]);

    await runSheetSyncScanner();

    expect(sheetSyncQueueMock.claimSheetSyncJobForProcessing).toHaveBeenCalledWith('sheet-sync-1');
    expect(googleSheetsMock.updateGoogleSheetRowsResilient).toHaveBeenCalledWith(
      'sheet-1',
      'Leads',
      ['Meeting Details', 'lead_status'],
      [
        {
          rowNumber: 2,
          values: {
            'Meeting Details': 'https://meet.google.com/cross-brand',
            lead_status: 'Demo Scheduled'
          },
          emailDeliveryId: 'delivery-1'
        }
      ],
      {},
      { workspaceKey: 'tallykonnect', googleAccountKey: 'tallykonnect-google' }
    );
    expect(sheetSyncQueueMock.markSheetSyncJobSucceeded).toHaveBeenCalledWith('sheet-sync-1');
    expect(emailDeliveryMock.markEmailSheetSyncSucceeded).toHaveBeenCalledWith('delivery-1');
  });

  it('does not call Google Sheets when another worker already claimed the job', async () => {
    sheetSyncQueueMock.claimSheetSyncJobForProcessing.mockResolvedValue(false);
    sheetSyncQueueMock.listDueSheetSyncJobs.mockResolvedValue([sheetSyncJob()]);

    await runSheetSyncScanner();

    expect(googleSheetsMock.updateGoogleSheetRowsResilient).not.toHaveBeenCalled();
    expect(sheetSyncQueueMock.markSheetSyncJobSucceeded).not.toHaveBeenCalled();
    expect(sheetSyncQueueMock.markSheetSyncJobFailed).not.toHaveBeenCalled();
  });

  it('treats row-level Google Sheets failures as retry failures', async () => {
    googleSheetsMock.updateGoogleSheetRowsResilient.mockResolvedValue([{ success: false, error: 'row rejected' }]);
    sheetSyncQueueMock.listDueSheetSyncJobs.mockResolvedValue([sheetSyncJob()]);

    await runSheetSyncScanner();

    expect(sheetSyncQueueMock.markSheetSyncJobFailed).toHaveBeenCalledWith(
      'sheet-sync-1',
      expect.objectContaining({ message: 'row rejected' })
    );
    expect(emailDeliveryMock.markEmailSheetSyncFailed).toHaveBeenCalledWith(
      'delivery-1',
      expect.objectContaining({ message: 'row rejected' })
    );
  });

  it('rejects an invalid persisted Google account before any Google Sheets call and continues to the next job', async () => {
    const invalidJob = sheetSyncJob({
      id: 'sheet-sync-invalid',
      googleAccountKey: 'broken-google-account'
    });
    const validJob = sheetSyncJob({
      id: 'sheet-sync-valid',
      googleAccountKey: 'anywheretally-google',
      workspaceKey: 'anywheretally',
      emailBrand: 'anywheretally'
    });
    sheetSyncQueueMock.listDueSheetSyncJobs.mockResolvedValue([invalidJob, validJob]);

    await runSheetSyncScanner();

    expect(googleSheetsMock.updateGoogleSheetRowsResilient).toHaveBeenCalledTimes(1);
    expect(googleSheetsMock.updateGoogleSheetRowsResilient).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Array),
      expect.any(Array),
      {},
      { workspaceKey: 'anywheretally', googleAccountKey: 'anywheretally-google' }
    );
    expect(sheetSyncQueueMock.markSheetSyncJobFailed).toHaveBeenCalledWith(
      'sheet-sync-invalid',
      expect.any(Error)
    );
  });

  it('does not mark another brand delivery when the linked EmailDelivery brand mismatches', async () => {
    emailDeliveryMock.findEmailDeliveryById.mockResolvedValue({
      id: 'delivery-1',
      emailBrand: 'tallykonnect'
    });
    sheetSyncQueueMock.listDueSheetSyncJobs.mockResolvedValue([sheetSyncJob()]);

    await runSheetSyncScanner();

    expect(googleSheetsMock.updateGoogleSheetRowsResilient).not.toHaveBeenCalled();
    expect(sheetSyncQueueMock.markSheetSyncJobFailed).toHaveBeenCalledWith(
      'sheet-sync-1',
      expect.objectContaining({ message: 'Linked EmailDelivery brand does not match this sheet sync job.' })
    );
    expect(emailDeliveryMock.markEmailSheetSyncFailed).not.toHaveBeenCalled();
    expect(emailDeliveryMock.markEmailSheetSyncSucceeded).not.toHaveBeenCalled();
  });
});
