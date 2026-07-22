import { prisma } from './db';
import { createWorkflowBusyError } from './workflowActivity';
import type { EmailBrandKey } from '../src/lib/emailBrand';

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

export async function getWorkflowControl(emailBrand: EmailBrandKey) {
  const existing = await prisma.workflowControl.findUnique({
    where: { id: emailBrand }
  });
  if (existing) return existing;

  try {
    return await prisma.workflowControl.create({
      data: { id: emailBrand }
    });
  } catch {
    return prisma.workflowControl.findUniqueOrThrow({
      where: { id: emailBrand }
    });
  }
}

export async function getWorkflowGenerationForNewJob(emailBrand: EmailBrandKey) {
  const control = await getWorkflowControl(emailBrand);
  if (control.isResetting) {
    throw createWorkflowBusyError();
  }
  return control.generation;
}

export async function beginWorkflowResetWindow(emailBrand: EmailBrandKey) {
  await getWorkflowControl(emailBrand);
  const acquired = await prisma.workflowControl.updateMany({
    where: {
      id: emailBrand,
      isResetting: false
    },
    data: { isResetting: true }
  });
  if (acquired.count !== 1) {
    throw createWorkflowBusyError();
  }
}

export async function advanceWorkflowGenerationForReset(emailBrand: EmailBrandKey) {
  return prisma.workflowControl.upsert({
    where: { id: emailBrand },
    update: {
      generation: { increment: 1 },
      isResetting: true
    },
    create: {
      id: emailBrand,
      generation: 2,
      isResetting: true
    }
  });
}

export async function finishWorkflowResetWindow(emailBrand: EmailBrandKey) {
  await prisma.workflowControl.upsert({
    where: { id: emailBrand },
    update: { isResetting: false },
    create: {
      id: emailBrand,
      isResetting: false
    }
  });
}

export async function assertWorkflowGenerationCurrent(emailBrand: EmailBrandKey, jobGeneration: number) {
  const control = await getWorkflowControl(emailBrand);
  if (control.isResetting) {
    throw createWorkflowBusyError();
  }
  if (control.generation !== jobGeneration) {
    throw createStaleWorkflowGenerationError(jobGeneration, control.generation);
  }
}
