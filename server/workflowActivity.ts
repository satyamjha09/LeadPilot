import { EMAIL_BRAND_KEYS, type EmailBrandKey } from '../src/lib/emailBrand';

export const WORKFLOW_BUSY_RESET_MESSAGE =
  'A workflow is currently running. Wait for it to finish before resetting.';

export type WorkflowActivityType = 'lead-processing' | 'sheet-sync';
export type WorkflowActivitySnapshot = {
  emailBrand: EmailBrandKey;
  leadProcessing: number;
  sheetSync: number;
  total: number;
  resetInProgress: boolean;
};

const createActivityCounts = (): Record<WorkflowActivityType, number> => ({
  'lead-processing': 0,
  'sheet-sync': 0
});

const activeCounts: Record<EmailBrandKey, Record<WorkflowActivityType, number>> = {
  tallykonnect: createActivityCounts(),
  anywheretally: createActivityCounts()
};

const resetInProgress: Record<EmailBrandKey, boolean> = {
  tallykonnect: false,
  anywheretally: false
};

export function createWorkflowBusyError() {
  const error = new Error(WORKFLOW_BUSY_RESET_MESSAGE);
  (error as Error & { statusCode?: number }).statusCode = 409;
  return error;
}

export function getActiveWorkflowSnapshot(emailBrand: EmailBrandKey): WorkflowActivitySnapshot;
export function getActiveWorkflowSnapshot(): Record<EmailBrandKey, WorkflowActivitySnapshot>;
export function getActiveWorkflowSnapshot(emailBrand?: EmailBrandKey) {
  if (!emailBrand) {
    return EMAIL_BRAND_KEYS.reduce<Record<EmailBrandKey, WorkflowActivitySnapshot>>((acc, brand) => {
      acc[brand] = getActiveWorkflowSnapshot(brand);
      return acc;
    }, {} as Record<EmailBrandKey, WorkflowActivitySnapshot>);
  }

  const leadProcessing = activeCounts[emailBrand]['lead-processing'];
  const sheetSync = activeCounts[emailBrand]['sheet-sync'];
  return {
    emailBrand,
    leadProcessing,
    sheetSync,
    total: leadProcessing + sheetSync,
    resetInProgress: resetInProgress[emailBrand]
  };
}

export function assertNoActiveWorkflow(emailBrand: EmailBrandKey) {
  if (getActiveWorkflowSnapshot(emailBrand).total > 0) {
    throw createWorkflowBusyError();
  }
}

export function beginResetGuard(emailBrand: EmailBrandKey) {
  if (resetInProgress[emailBrand]) {
    throw createWorkflowBusyError();
  }
  assertNoActiveWorkflow(emailBrand);
  resetInProgress[emailBrand] = true;

  return () => {
    resetInProgress[emailBrand] = false;
  };
}

export async function withWorkflowActivity<T>(
  type: WorkflowActivityType,
  emailBrand: EmailBrandKey,
  action: () => Promise<T>
): Promise<T> {
  if (resetInProgress[emailBrand]) {
    throw createWorkflowBusyError();
  }

  activeCounts[emailBrand][type] += 1;
  try {
    return await action();
  } finally {
    activeCounts[emailBrand][type] = Math.max(0, activeCounts[emailBrand][type] - 1);
  }
}
