import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createWorkflowBusyError } from './workflowActivity';
import { prisma } from './db';
import { coerceStoredEmailBrand, type EmailBrandKey } from '../src/lib/emailBrand';

export const PROCESS_LEAD_QUEUE_NAME = 'process-lead-jobs';
const PROCESS_QUEUE_RESET_COUNT = 1000;
const REMOVABLE_RESET_JOB_STATES = ['waiting', 'delayed', 'prioritized', 'paused'] as const;

let connection: IORedis | null = null;
let queue: Queue | null = null;

export function isProcessQueueEnabled() {
  return process.env.PROCESS_QUEUE_ENABLED === 'true';
}

export function getProcessQueueConcurrency() {
  const value = Number(process.env.PROCESS_QUEUE_CONCURRENCY || 1);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

export function getProcessQueueConnection() {
  if (!isProcessQueueEnabled()) {
    throw new Error('Process queue is disabled.');
  }
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is required when PROCESS_QUEUE_ENABLED=true.');
  }
  if (!connection) {
    connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    });
  }
  return connection;
}

export function getProcessLeadQueue() {
  if (!queue) {
    queue = new Queue(PROCESS_LEAD_QUEUE_NAME, {
      connection: getProcessQueueConnection() as any
    });
  }
  return queue;
}

export async function enqueueProcessLeadJob(jobId: string, generation: number | undefined, emailBrand: EmailBrandKey) {
  const processQueue = getProcessLeadQueue();
  return processQueue.add(
    'process-leads',
    { jobId, generation, emailBrand },
    {
      jobId,
      attempts: 1,
      removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 }
    }
  );
}

async function getProcessQueueJobBrand(job: { data?: any }) {
  if (job.data?.emailBrand) {
    return coerceStoredEmailBrand(job.data.emailBrand);
  }

  const jobId = String(job.data?.jobId || '');
  if (!jobId) return null;

  const processJob = await prisma.processLeadJob.findUnique({
    where: { id: jobId },
    select: { emailBrand: true }
  });

  return processJob ? coerceStoredEmailBrand(processJob.emailBrand) : null;
}

export async function clearProcessQueueResetData(emailBrand: EmailBrandKey, processQueue?: Queue) {
  const queueToClear = processQueue || getProcessLeadQueue();
  const jobs = await queueToClear.getJobs([...REMOVABLE_RESET_JOB_STATES], 0, PROCESS_QUEUE_RESET_COUNT - 1);
  let removed = 0;

  for (const job of jobs) {
    const jobBrand = await getProcessQueueJobBrand(job);
    if (jobBrand !== emailBrand) continue;

    const state = await job.getState();
    if (!REMOVABLE_RESET_JOB_STATES.includes(state as (typeof REMOVABLE_RESET_JOB_STATES)[number])) {
      if (state === 'active') throw createWorkflowBusyError();
      continue;
    }

    await job.remove();
    removed += 1;
  }

  return { removed };
}

export async function prepareProcessQueueForReset(emailBrand: EmailBrandKey, processQueue?: Queue) {
  if (!isProcessQueueEnabled()) {
    return async () => {};
  }

  const queueToPrepare = processQueue || getProcessLeadQueue();
  await queueToPrepare.pause();

  try {
    const activeJobs = await queueToPrepare.getJobs(['active'], 0, PROCESS_QUEUE_RESET_COUNT - 1);
    for (const activeJob of activeJobs) {
      const activeBrand = await getProcessQueueJobBrand(activeJob);
      if (!activeBrand || activeBrand === emailBrand) {
        throw createWorkflowBusyError();
      }
    }

    await clearProcessQueueResetData(emailBrand, queueToPrepare);

    return async () => {
      await queueToPrepare.resume();
    };
  } catch (error) {
    await queueToPrepare.resume();
    throw error;
  }
}
