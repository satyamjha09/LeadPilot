import { ExcelRow } from '../src/types';
import { prisma } from './db';
import { normalizeEmailBrand, type EmailBrandKey } from './emailTemplates';
import { getWorkflowGenerationForNewJob } from './workflowControl';

export type ProcessLeadJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type ProcessLeadJobProgress = {
  total: number;
  processed: number;
  success: number;
  failed: number;
  skipped: number;
  currentName?: string;
  currentEmail?: string;
};

export type ProcessLeadJobInput = {
  sourceType: 'excel' | 'google-sheet';
  emailBrand?: EmailBrandKey;
  spreadsheetId?: string;
  sheetName?: string;
  headers?: string[];
  rows: ExcelRow[];
};

const initialProgress = (total: number): ProcessLeadJobProgress => ({
  total,
  processed: 0,
  success: 0,
  failed: 0,
  skipped: 0
});

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function createProcessLeadJob(input: ProcessLeadJobInput) {
  const generation = await getWorkflowGenerationForNewJob();

  return prisma.processLeadJob.create({
    data: {
      status: 'QUEUED',
      generation,
      sourceType: input.sourceType,
      emailBrand: normalizeEmailBrand(input.emailBrand),
      spreadsheetId: input.spreadsheetId || null,
      sheetName: input.sheetName || null,
      headersJson: input.headers ? JSON.stringify(input.headers) : null,
      inputRowsJson: JSON.stringify(input.rows),
      progressJson: JSON.stringify(initialProgress(input.rows.length))
    }
  });
}

export async function getProcessLeadJob(id: string) {
  return prisma.processLeadJob.findUnique({ where: { id } });
}

export async function markProcessLeadJobRunning(id: string, total: number) {
  return prisma.processLeadJob.update({
    where: { id },
    data: {
      status: 'RUNNING',
      error: null,
      progressJson: JSON.stringify(initialProgress(total))
    }
  });
}

export async function updateProcessLeadJobProgress(id: string, progress: ProcessLeadJobProgress) {
  return prisma.processLeadJob.update({
    where: { id },
    data: {
      progressJson: JSON.stringify(progress)
    }
  });
}

export async function markProcessLeadJobCompleted(
  id: string,
  result: {
    rows: ExcelRow[];
    summary: unknown;
    headers?: string[];
    sheetSyncError?: string;
  },
  progress: ProcessLeadJobProgress
) {
  return prisma.processLeadJob.update({
    where: { id },
    data: {
      status: 'COMPLETED',
      resultRowsJson: JSON.stringify(result.rows),
      summaryJson: JSON.stringify({
        summary: result.summary,
        headers: result.headers,
        sheetSyncError: result.sheetSyncError
      }),
      progressJson: JSON.stringify(progress),
      error: null
    }
  });
}

export async function markProcessLeadJobFailed(id: string, error: string, progress?: ProcessLeadJobProgress) {
  return prisma.processLeadJob.update({
    where: { id },
    data: {
      status: 'FAILED',
      error,
      ...(progress ? { progressJson: JSON.stringify(progress) } : {})
    }
  });
}

export function serializeProcessLeadJob(job: Awaited<ReturnType<typeof getProcessLeadJob>>) {
  if (!job) return null;
  const inputRows = parseJson<ExcelRow[]>(job.inputRowsJson, []);
  const summaryPayload = parseJson<{
    summary?: unknown;
    headers?: string[];
    sheetSyncError?: string;
  }>(job.summaryJson, {});

  return {
    id: job.id,
    jobId: job.id,
    status: job.status,
    generation: job.generation,
    sourceType: job.sourceType,
    emailBrand: normalizeEmailBrand(job.emailBrand),
    spreadsheetId: job.spreadsheetId || undefined,
    sheetName: job.sheetName || undefined,
    progress: parseJson<ProcessLeadJobProgress>(job.progressJson, initialProgress(inputRows.length)),
    rows: parseJson<ExcelRow[]>(job.resultRowsJson, []),
    summary: summaryPayload.summary,
    headers: summaryPayload.headers,
    sheetSyncError: summaryPayload.sheetSyncError,
    error: job.error || undefined,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

export function parseProcessLeadJobInput(job: Awaited<ReturnType<typeof getProcessLeadJob>>): ProcessLeadJobInput {
  if (!job) throw new Error('Process job not found.');
  return {
    sourceType: job.sourceType === 'google-sheet' ? 'google-sheet' : 'excel',
    emailBrand: normalizeEmailBrand(job.emailBrand),
    spreadsheetId: job.spreadsheetId || undefined,
    sheetName: job.sheetName || undefined,
    headers: parseJson<string[]>(job.headersJson, []),
    rows: parseJson<ExcelRow[]>(job.inputRowsJson, [])
  };
}
