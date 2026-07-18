import { beforeEach, describe, expect, it, vi } from 'vitest';

const sheetSyncQueueMock = vi.hoisted(() => ({
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
  markEmailSheetSyncFailed: vi.fn(),
  markEmailSheetSyncSucceeded: vi.fn()
}));

vi.mock('./emailDelivery', () => emailDeliveryMock);

vi.mock('./workflowActivity', () => ({
  withWorkflowActivity: (_type: string, action: () => unknown) => action()
}));

const { runSheetSyncScanner } = await import('./sheetSyncWorker');

function sheetSyncJob(emailBrand: 'tallykonnect' | 'anywheretally') {
  return {
    id: `sheet-sync-${emailBrand}`,
    emailBrand,
    spreadsheetId: 'sheet-1',
    sheetName: 'Leads',
    rowNumber: 2,
    headersJson: JSON.stringify(['Meeting Details', 'lead_status']),
    valuesJson: JSON.stringify({
      'Meeting Details': `https://meet.google.com/${emailBrand}`,
      lead_status: 'Demo Scheduled'
    }),
    emailDeliveryId: `delivery-${emailBrand}`,
    retryCount: 1,
    maxRetries: 3
  };
}

describe('brand-scoped Google Sheet retry worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sheetSyncQueueMock.markSheetSyncJobFailed.mockResolvedValue(undefined);
    sheetSyncQueueMock.markSheetSyncJobSucceeded.mockResolvedValue(undefined);
    emailDeliveryMock.markEmailSheetSyncFailed.mockResolvedValue(undefined);
    emailDeliveryMock.markEmailSheetSyncSucceeded.mockResolvedValue(undefined);
    googleSheetsMock.updateGoogleSheetRowsResilient.mockResolvedValue([{ success: true }]);
  });

  it('uses AnyWhereTally OAuth when retrying an AnyWhereTally Sheet update', async () => {
    sheetSyncQueueMock.listDueSheetSyncJobs.mockResolvedValue([sheetSyncJob('anywheretally')]);

    await runSheetSyncScanner();

    expect(googleSheetsMock.updateGoogleSheetRowsResilient).toHaveBeenCalledWith(
      'sheet-1',
      'Leads',
      ['Meeting Details', 'lead_status'],
      [
        {
          rowNumber: 2,
          values: {
            'Meeting Details': 'https://meet.google.com/anywheretally',
            lead_status: 'Demo Scheduled'
          },
          emailDeliveryId: 'delivery-anywheretally'
        }
      ],
      {},
      'anywheretally'
    );
    expect(sheetSyncQueueMock.markSheetSyncJobSucceeded).toHaveBeenCalledWith('sheet-sync-anywheretally');
    expect(emailDeliveryMock.markEmailSheetSyncSucceeded).toHaveBeenCalledWith('delivery-anywheretally');
  });

  it('uses TallyKonnect OAuth when retrying a TallyKonnect Sheet update', async () => {
    sheetSyncQueueMock.listDueSheetSyncJobs.mockResolvedValue([sheetSyncJob('tallykonnect')]);

    await runSheetSyncScanner();

    expect(googleSheetsMock.updateGoogleSheetRowsResilient).toHaveBeenCalledWith(
      'sheet-1',
      'Leads',
      ['Meeting Details', 'lead_status'],
      [
        {
          rowNumber: 2,
          values: {
            'Meeting Details': 'https://meet.google.com/tallykonnect',
            lead_status: 'Demo Scheduled'
          },
          emailDeliveryId: 'delivery-tallykonnect'
        }
      ],
      {},
      'tallykonnect'
    );
    expect(sheetSyncQueueMock.markSheetSyncJobSucceeded).toHaveBeenCalledWith('sheet-sync-tallykonnect');
    expect(emailDeliveryMock.markEmailSheetSyncSucceeded).toHaveBeenCalledWith('delivery-tallykonnect');
  });
});
