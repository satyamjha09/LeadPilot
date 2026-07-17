export const WORKFLOW_BUSY_RESET_MESSAGE =
  'A workflow is currently running. Wait for it to finish before resetting.';

export type WorkflowActivityType = 'lead-processing' | 'sheet-sync';

const activeCounts: Record<WorkflowActivityType, number> = {
  'lead-processing': 0,
  'sheet-sync': 0
};

let resetInProgress = false;

export function createWorkflowBusyError() {
  const error = new Error(WORKFLOW_BUSY_RESET_MESSAGE);
  (error as Error & { statusCode?: number }).statusCode = 409;
  return error;
}

export function getActiveWorkflowSnapshot() {
  const leadProcessing = activeCounts['lead-processing'];
  const sheetSync = activeCounts['sheet-sync'];
  return {
    leadProcessing,
    sheetSync,
    total: leadProcessing + sheetSync,
    resetInProgress
  };
}

export function assertNoActiveWorkflow() {
  if (getActiveWorkflowSnapshot().total > 0) {
    throw createWorkflowBusyError();
  }
}

export function beginResetGuard() {
  assertNoActiveWorkflow();
  resetInProgress = true;

  return () => {
    resetInProgress = false;
  };
}

export async function withWorkflowActivity<T>(
  type: WorkflowActivityType,
  action: () => Promise<T>
): Promise<T> {
  if (resetInProgress) {
    throw createWorkflowBusyError();
  }

  activeCounts[type] += 1;
  try {
    return await action();
  } finally {
    activeCounts[type] = Math.max(0, activeCounts[type] - 1);
  }
}
