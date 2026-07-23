import dotenv from 'dotenv';
import { Worker } from 'bullmq';
import {
  getProcessQueueConcurrency,
  getProcessQueueConnection,
  isProcessQueueEnabled,
  PROCESS_LEAD_QUEUE_NAME
} from '../processLeadQueue';
import {
  getProcessLeadJob,
  markProcessLeadJobCompleted,
  markProcessLeadJobFailed,
  markProcessLeadJobRunning,
  parseProcessLeadJobInput,
  ProcessLeadJobProgress,
  updateProcessLeadJobProgress
} from '../processLeadJobs';
import { ensureRequiredColumns, friendlySheetsError, googleSheetAccessForWorkspace } from '../googleSheets';
import { processLeadsByStatus } from '../leadWorkflow';
import { applyDbTruthToRows } from '../scheduleDb';
import { withWorkflowActivity } from '../workflowActivity';
import { assertWorkflowGenerationCurrent, isStaleWorkflowGenerationError } from '../workflowControl';
import { coerceStoredEmailBrand } from '../../src/lib/emailBrand';
import { assertWorkflowAutomationIds } from '../workflowAutomationIds';

dotenv.config();

async function processLeadJob(jobId: string, queuedGeneration?: number) {
  const jobRecord = await getProcessLeadJob(jobId);
  if (!jobRecord) throw new Error('Process job not found.');
  const jobGeneration = jobRecord.generation;
  const input = parseProcessLeadJobInput(jobRecord);
  if (queuedGeneration && queuedGeneration !== jobGeneration) {
    throw new Error('Process job generation does not match queued payload.');
  }
  const assertCurrentGeneration = () => assertWorkflowGenerationCurrent(input.emailBrand, jobGeneration);

  await assertCurrentGeneration();

  let headers = input.headers || [];
  const sheetAccess =
    input.sourceType === 'google-sheet'
      ? {
          workspaceKey: input.workspaceKey,
          googleAccountKey: input.googleAccountKey || googleSheetAccessForWorkspace(input.workspaceKey).googleAccountKey
        }
      : undefined;
  if (input.sourceType === 'google-sheet') {
    if (!input.spreadsheetId || !input.sheetName) {
      throw new Error('spreadsheetId and sheetName are required.');
    }
    if (!headers.length) {
      throw new Error('Google Sheet headers are required.');
    }
    const ensured = await ensureRequiredColumns(
      input.spreadsheetId,
      input.sheetName,
      headers,
      sheetAccess
    );
    headers = ensured.headers;
  }

  const progress: ProcessLeadJobProgress = {
    total: input.rows.length,
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0
  };

  await assertCurrentGeneration();
  await markProcessLeadJobRunning(jobId, input.rows.length);
  const dbRows = await applyDbTruthToRows(input.rows, input.emailBrand);
  assertWorkflowAutomationIds(dbRows);

  const result = await withWorkflowActivity('lead-processing', input.emailBrand, async () =>
    processLeadsByStatus(dbRows, {
      sourceType: input.sourceType,
      workspaceKey: input.workspaceKey,
      spreadsheetId: input.spreadsheetId,
      sheetName: input.sheetName,
      headers,
      senderAccountKey: input.senderAccountKey,
      googleAccountKey: sheetAccess?.googleAccountKey || googleSheetAccessForWorkspace(input.workspaceKey).googleAccountKey,
      emailBrandKey: input.emailBrandKey,
      emailBrand: input.emailBrand,
      assertStillCurrent: assertCurrentGeneration,
      onRowProcessed: async (row, rowSummary) => {
        await assertCurrentGeneration();
        progress.processed += 1;
        progress.success =
          rowSummary.demoScheduled +
          rowSummary.demoDone +
          rowSummary.noResponse +
          rowSummary.statusOnly +
          rowSummary.reschedule;
        progress.failed = rowSummary.failed;
        progress.skipped = rowSummary.skipped;
        progress.currentName = String(row.full_name || '');
        progress.currentEmail = row.email ? String(row.email) : undefined;
        await updateProcessLeadJobProgress(jobId, progress);
      }
    })
  );

  const finalProgress: ProcessLeadJobProgress = {
    ...progress,
    processed: result.rows.length,
    failed: result.summary.failed,
    skipped: result.summary.skipped,
    success:
      result.summary.demoScheduled +
      result.summary.demoDone +
      result.summary.noResponse +
      result.summary.statusOnly +
      result.summary.reschedule
  };

  await assertCurrentGeneration();
  await markProcessLeadJobCompleted(
    jobId,
    {
      rows: result.rows,
      summary: result.summary,
      headers,
      sheetSyncError: result.sheetSyncError
    },
    finalProgress
  );
}

export function startProcessLeadWorker() {
  if (!isProcessQueueEnabled()) {
    console.log('Process lead worker disabled.');
    return null;
  }

  const worker = new Worker(
    PROCESS_LEAD_QUEUE_NAME,
    async (job) => {
      const jobId = String(job.data?.jobId || '');
      const queuedGeneration = Number(job.data?.generation || 0) || undefined;
      const queuedBrand = job.data?.emailBrand ? coerceStoredEmailBrand(job.data.emailBrand) : undefined;
      if (!jobId) throw new Error('Missing process lead jobId.');

      try {
        if (queuedBrand) {
          const queuedRecord = await getProcessLeadJob(jobId);
          if (queuedRecord && coerceStoredEmailBrand(queuedRecord.emailBrand) !== queuedBrand) {
            throw new Error('Process job brand does not match queued payload.');
          }
        }
        await processLeadJob(jobId, queuedGeneration);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : 'Lead processing job failed.';
        const friendly = friendlySheetsError(err);
        if (!isStaleWorkflowGenerationError(err)) {
          await (async () => {
            const currentJob = await getProcessLeadJob(jobId);
            if (!currentJob) return;
            await assertWorkflowGenerationCurrent(coerceStoredEmailBrand(currentJob.emailBrand), currentJob.generation);
            await markProcessLeadJobFailed(jobId, friendly?.message || message);
          })().catch((error) => {
            console.error('PROCESS_LEAD_JOB_MARK_FAILED_ERROR', {
              processJobId: jobId,
              message: error instanceof Error ? error.message : String(error)
            });
          });
        }
        throw err;
      }
    },
    {
      connection: getProcessQueueConnection() as any,
      concurrency: getProcessQueueConcurrency()
    }
  );

  worker.on('failed', (job, err) => {
    console.error('PROCESS_LEAD_JOB_FAILED', {
      bullJobId: job?.id,
      processJobId: job?.data?.jobId,
      message: err.message
    });
  });

  worker.on('completed', (job) => {
    console.log('PROCESS_LEAD_JOB_COMPLETED', {
      bullJobId: job.id,
      processJobId: job.data?.jobId
    });
  });

  console.log(`Process lead worker started with concurrency ${getProcessQueueConcurrency()}.`);
  return worker;
}

if (process.env.PROCESS_LEAD_WORKER_STANDALONE === 'true') {
  startProcessLeadWorker();
}
