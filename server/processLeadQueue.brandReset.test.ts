import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareProcessQueueForReset } from './processLeadQueue';

const originalQueueEnabled = process.env.PROCESS_QUEUE_ENABLED;

function fakeJob(emailBrand: 'tallykonnect' | 'anywheretally', state: string) {
  return {
    data: {
      jobId: `job-${emailBrand}-${state}`,
      emailBrand
    },
    getState: vi.fn().mockResolvedValue(state),
    remove: vi.fn().mockResolvedValue(undefined)
  };
}

function fakeQueue(activeJobs: any[], queuedJobs: any[]) {
  return {
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    getJobs: vi.fn().mockImplementation(async (states: string[]) => {
      if (states.includes('active')) return activeJobs;
      return queuedJobs;
    })
  };
}

describe('brand-scoped process queue reset', () => {
  beforeEach(() => {
    process.env.PROCESS_QUEUE_ENABLED = 'true';
  });

  afterEach(() => {
    if (originalQueueEnabled === undefined) {
      delete process.env.PROCESS_QUEUE_ENABLED;
    } else {
      process.env.PROCESS_QUEUE_ENABLED = originalQueueEnabled;
    }
  });

  it('removes only waiting jobs for the selected brand', async () => {
    const activeOtherBrand = fakeJob('anywheretally', 'active');
    const waitingSelectedBrand = fakeJob('tallykonnect', 'waiting');
    const delayedOtherBrand = fakeJob('anywheretally', 'delayed');
    const queue = fakeQueue([activeOtherBrand], [waitingSelectedBrand, delayedOtherBrand]);

    const resumeQueue = await prepareProcessQueueForReset('tallykonnect', queue as any);

    expect(queue.pause).toHaveBeenCalled();
    expect(activeOtherBrand.remove).not.toHaveBeenCalled();
    expect(waitingSelectedBrand.remove).toHaveBeenCalled();
    expect(delayedOtherBrand.remove).not.toHaveBeenCalled();
    expect(queue.resume).not.toHaveBeenCalled();

    await resumeQueue();
    expect(queue.resume).toHaveBeenCalledTimes(1);
  });

  it('blocks reset when an active job belongs to the selected brand', async () => {
    const activeSelectedBrand = fakeJob('anywheretally', 'active');
    const waitingSelectedBrand = fakeJob('anywheretally', 'waiting');
    const queue = fakeQueue([activeSelectedBrand], [waitingSelectedBrand]);

    await expect(prepareProcessQueueForReset('anywheretally', queue as any)).rejects.toThrow(
      'A workflow is currently running. Wait for it to finish before resetting.'
    );

    expect(waitingSelectedBrand.remove).not.toHaveBeenCalled();
    expect(queue.resume).toHaveBeenCalledTimes(1);
  });
});
