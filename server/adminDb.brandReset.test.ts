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
  googleAuth: { deleteMany: vi.fn() }
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn()
}));

vi.mock('./db', () => ({
  prisma: prismaMock
}));

const { resetDemoTestData } = await import('./adminDb');

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
});
