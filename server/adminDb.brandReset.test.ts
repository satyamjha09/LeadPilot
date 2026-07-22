import { beforeEach, describe, expect, it, vi } from 'vitest';

const txMock = vi.hoisted(() => ({
  sheetSyncJob: { deleteMany: vi.fn() },
  emailDelivery: { deleteMany: vi.fn() },
  emailLog: { deleteMany: vi.fn() },
  sheetLeadState: { deleteMany: vi.fn() },
  demoHistory: { deleteMany: vi.fn() },
  customerDemoState: { deleteMany: vi.fn() },
  leadSchedule: { deleteMany: vi.fn() },
  processLeadJob: { deleteMany: vi.fn() },
  googleAuth: { deleteMany: vi.fn() },
  googleOAuthState: { deleteMany: vi.fn() },
  workspace: { deleteMany: vi.fn() },
  dataSource: { deleteMany: vi.fn() },
  dataSourceTab: { deleteMany: vi.fn() },
  sourceSnapshot: { deleteMany: vi.fn() },
  sourceRow: { deleteMany: vi.fn() },
  lead: { deleteMany: vi.fn() },
  leadIdentity: { deleteMany: vi.fn() },
  leadMatchRun: { deleteMany: vi.fn() },
  leadMatchResult: { deleteMany: vi.fn() },
  leadMatchConflict: { deleteMany: vi.fn() },
  leadMergeHistory: { deleteMany: vi.fn() }
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  processLeadJob: { count: vi.fn() },
  emailDelivery: { count: vi.fn() },
  sheetSyncJob: { count: vi.fn() },
  customerDemoState: { findMany: vi.fn() },
  demoHistory: { findMany: vi.fn() }
}));

const googleAuthMock = vi.hoisted(() => ({
  cancelCalendarMeeting: vi.fn()
}));

vi.mock('./googleAuth', () => googleAuthMock);

vi.mock('./db', () => ({
  prisma: prismaMock
}));

const {
  assertNoActiveResetClaims,
  cancelActiveCalendarEventsForReset,
  resetDemoTestData
} = await import('./adminDb');

describe('brand-scoped workflow data reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const model of [
      txMock.sheetSyncJob,
      txMock.emailDelivery,
      txMock.emailLog,
      txMock.sheetLeadState,
      txMock.demoHistory,
      txMock.customerDemoState,
      txMock.leadSchedule,
      txMock.processLeadJob
    ]) {
      model.deleteMany.mockResolvedValue({ count: 1 });
    }
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(txMock));
    prismaMock.processLeadJob.count.mockResolvedValue(0);
    prismaMock.emailDelivery.count.mockResolvedValue(0);
    prismaMock.sheetSyncJob.count.mockResolvedValue(0);
    prismaMock.customerDemoState.findMany.mockResolvedValue([]);
    prismaMock.demoHistory.findMany.mockResolvedValue([]);
    googleAuthMock.cancelCalendarMeeting.mockResolvedValue({ cancelled: true, alreadyDeleted: false });
  });

  it('deletes only the selected brand from workflow tables', async () => {
    const result = await resetDemoTestData('anywheretally');

    for (const model of [
      txMock.sheetSyncJob,
      txMock.emailDelivery,
      txMock.emailLog,
      txMock.sheetLeadState,
      txMock.demoHistory,
      txMock.customerDemoState,
      txMock.leadSchedule,
      txMock.processLeadJob
    ]) {
      expect(model.deleteMany).toHaveBeenCalledWith({
        where: { emailBrand: 'anywheretally' }
      });
    }
    expect(txMock.googleAuth.deleteMany).not.toHaveBeenCalled();
    expect(txMock.googleOAuthState.deleteMany).not.toHaveBeenCalled();
    for (const model of [
      txMock.workspace,
      txMock.dataSource,
      txMock.dataSourceTab,
      txMock.sourceSnapshot,
      txMock.sourceRow,
      txMock.lead,
      txMock.leadIdentity,
      txMock.leadMatchRun,
      txMock.leadMatchResult,
      txMock.leadMatchConflict,
      txMock.leadMergeHistory
    ]) {
      expect(model.deleteMany).not.toHaveBeenCalled();
    }
    expect(result).toMatchObject({
      SheetSyncJob: 1,
      EmailDelivery: 1,
      EmailLog: 1,
      SheetLeadState: 1,
      DemoHistory: 1,
      CustomerDemoState: 1,
      LeadSchedule: 1,
      ProcessLeadJob: 1
    });
  });

  it('removes history before brand-specific customer state', async () => {
    await resetDemoTestData('tallykonnect');

    expect(txMock.demoHistory.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.customerDemoState.deleteMany.mock.invocationCallOrder[0]
    );
  });

  it('blocks reset when selected-brand durable claims are freshly active', async () => {
    prismaMock.processLeadJob.count.mockResolvedValueOnce(0);
    prismaMock.emailDelivery.count.mockResolvedValueOnce(1);
    prismaMock.sheetSyncJob.count.mockResolvedValueOnce(0);

    await expect(assertNoActiveResetClaims('anywheretally')).rejects.toMatchObject({
      code: 'WORKFLOW_BUSY',
      statusCode: 409
    });
  });

  it('cancels selected-brand active calendar events with persisted sender accounts', async () => {
    prismaMock.customerDemoState.findMany.mockResolvedValue([
      {
        calendarEventId: 'event-awt-cross',
        senderAccountKey: 'tallykonnect-google'
      }
    ]);
    prismaMock.demoHistory.findMany.mockResolvedValue([
      {
        calendarEventId: 'event-awt-cross',
        senderAccountKey: 'tallykonnect-google'
      },
      {
        calendarEventId: 'event-awt-own',
        senderAccountKey: 'anywheretally-google'
      }
    ]);
    googleAuthMock.cancelCalendarMeeting
      .mockResolvedValueOnce({ cancelled: true, alreadyDeleted: false })
      .mockResolvedValueOnce({ cancelled: true, alreadyDeleted: true });

    const result = await cancelActiveCalendarEventsForReset('anywheretally');

    expect(prismaMock.customerDemoState.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ emailBrand: 'anywheretally' }) })
    );
    expect(googleAuthMock.cancelCalendarMeeting).toHaveBeenCalledTimes(2);
    expect(googleAuthMock.cancelCalendarMeeting).toHaveBeenCalledWith('event-awt-cross', 'tallykonnect-google');
    expect(googleAuthMock.cancelCalendarMeeting).toHaveBeenCalledWith('event-awt-own', 'anywheretally-google');
    expect(result).toEqual({
      cancelledCalendarEventCount: 2,
      alreadyDeletedCalendarEventCount: 1
    });
  });

  it('does not delete workflow rows when calendar cancellation fails', async () => {
    prismaMock.customerDemoState.findMany.mockResolvedValue([
      {
        calendarEventId: 'event-fail',
        senderAccountKey: 'anywheretally-google'
      }
    ]);
    googleAuthMock.cancelCalendarMeeting.mockRejectedValue(new Error('Calendar down'));

    await expect(cancelActiveCalendarEventsForReset('anywheretally')).rejects.toThrow('Calendar down');
    expect(txMock.demoHistory.deleteMany).not.toHaveBeenCalled();
    expect(txMock.customerDemoState.deleteMany).not.toHaveBeenCalled();
  });
});
