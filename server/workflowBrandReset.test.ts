import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  workflowControl: {
    findUnique: vi.fn(),
    create: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    upsert: vi.fn()
  }
}));

vi.mock('./db', () => ({
  prisma: prismaMock
}));

const {
  advanceWorkflowGenerationForReset,
  assertWorkflowGenerationCurrent,
  beginWorkflowResetWindow,
  finishWorkflowResetWindow,
  getWorkflowGenerationForNewJob
} = await import('./workflowControl');

const {
  beginResetGuard,
  getActiveWorkflowSnapshot,
  withWorkflowActivity
} = await import('./workflowActivity');

describe('brand-scoped workflow control and activity reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.workflowControl.findUnique.mockResolvedValue({
      id: 'tallykonnect',
      generation: 3,
      isResetting: false
    });
    prismaMock.workflowControl.upsert.mockResolvedValue({
      id: 'anywheretally',
      generation: 4,
      isResetting: true
    });
  });

  it('reads new job generation from the selected brand row', async () => {
    await getWorkflowGenerationForNewJob('anywheretally');

    expect(prismaMock.workflowControl.findUnique).toHaveBeenCalledWith({
      where: { id: 'anywheretally' }
    });
  });

  it('advances reset generation only for the selected brand', async () => {
    await advanceWorkflowGenerationForReset('anywheretally');

    expect(prismaMock.workflowControl.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'anywheretally' },
        update: expect.objectContaining({
          generation: { increment: 1 },
          isResetting: true
        })
      })
    );
  });

  it('opens and closes reset windows only for the selected brand', async () => {
    await beginWorkflowResetWindow('tallykonnect');
    await finishWorkflowResetWindow('tallykonnect');

    expect(prismaMock.workflowControl.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'tallykonnect' },
        update: { isResetting: true }
      })
    );
    expect(prismaMock.workflowControl.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'tallykonnect' },
        update: { isResetting: false }
      })
    );
  });

  it('checks stale generation against the selected brand row', async () => {
    prismaMock.workflowControl.findUnique.mockResolvedValue({
      id: 'anywheretally',
      generation: 9,
      isResetting: false
    });

    await expect(assertWorkflowGenerationCurrent('anywheretally', 8)).rejects.toMatchObject({
      code: 'STALE_WORKFLOW_GENERATION',
      jobGeneration: 8,
      currentGeneration: 9
    });
  });

  it('allows one brand reset while the other brand has in-memory activity', async () => {
    let releaseActivity!: () => void;
    const activeWork = withWorkflowActivity(
      'lead-processing',
      'anywheretally',
      async () =>
        new Promise<void>((resolve) => {
          releaseActivity = resolve;
        })
    );

    expect(getActiveWorkflowSnapshot('anywheretally').total).toBe(1);
    let finishTallyReset!: () => void;
    expect(() => {
      finishTallyReset = beginResetGuard('tallykonnect');
    }).not.toThrow();
    finishTallyReset();
    expect(() => beginResetGuard('anywheretally')).toThrow(
      'A workflow is currently running. Wait for it to finish before resetting.'
    );

    releaseActivity();
    await activeWork;
  });

  it('blocks a second reset for the same brand while reset is in progress', () => {
    const finishReset = beginResetGuard('tallykonnect');
    try {
      expect(() => beginResetGuard('tallykonnect')).toThrow(
        'A workflow is currently running. Wait for it to finish before resetting.'
      );
    } finally {
      finishReset();
    }
  });
});
