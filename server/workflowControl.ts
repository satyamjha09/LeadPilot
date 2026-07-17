import { prisma } from './db';
import { createWorkflowBusyError } from './workflowActivity';

export const WORKFLOW_CONTROL_ID = 'global';
export const STALE_WORKFLOW_GENERATION_CODE = 'STALE_WORKFLOW_GENERATION';
export const STALE_WORKFLOW_GENERATION_MESSAGE =
  'Workflow cancelled because application data was reset.';

type WorkflowGenerationError = Error & {
  code?: string;
  statusCode?: number;
  jobGeneration?: number;
  currentGeneration?: number;
};

export function createStaleWorkflowGenerationError(jobGeneration: number, currentGeneration: number) {
  const error = new Error(STALE_WORKFLOW_GENERATION_MESSAGE) as WorkflowGenerationError;
  error.code = STALE_WORKFLOW_GENERATION_CODE;
  error.statusCode = 409;
  error.jobGeneration = jobGeneration;
  error.currentGeneration = currentGeneration;
  return error;
}

export function isStaleWorkflowGenerationError(error: unknown) {
  return (
    error instanceof Error &&
    (error as WorkflowGenerationError).code === STALE_WORKFLOW_GENERATION_CODE
  );
}

export async function getWorkflowControl() {
  const existing = await prisma.workflowControl.findUnique({
    where: { id: WORKFLOW_CONTROL_ID }
  });
  if (existing) return existing;

  try {
    return await prisma.workflowControl.create({
      data: { id: WORKFLOW_CONTROL_ID }
    });
  } catch {
    return prisma.workflowControl.findUniqueOrThrow({
      where: { id: WORKFLOW_CONTROL_ID }
    });
  }
}

export async function getWorkflowGenerationForNewJob() {
  const control = await getWorkflowControl();
  if (control.isResetting) {
    throw createWorkflowBusyError();
  }
  return control.generation;
}

export async function beginWorkflowResetWindow() {
  await prisma.workflowControl.upsert({
    where: { id: WORKFLOW_CONTROL_ID },
    update: { isResetting: true },
    create: {
      id: WORKFLOW_CONTROL_ID,
      isResetting: true
    }
  });
}

export async function advanceWorkflowGenerationForReset() {
  return prisma.workflowControl.upsert({
    where: { id: WORKFLOW_CONTROL_ID },
    update: {
      generation: { increment: 1 },
      isResetting: true
    },
    create: {
      id: WORKFLOW_CONTROL_ID,
      generation: 2,
      isResetting: true
    }
  });
}

export async function finishWorkflowResetWindow() {
  await prisma.workflowControl.upsert({
    where: { id: WORKFLOW_CONTROL_ID },
    update: { isResetting: false },
    create: {
      id: WORKFLOW_CONTROL_ID,
      isResetting: false
    }
  });
}

export async function assertWorkflowGenerationCurrent(jobGeneration: number) {
  const control = await getWorkflowControl();
  if (control.generation !== jobGeneration) {
    throw createStaleWorkflowGenerationError(jobGeneration, control.generation);
  }
}
