import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createWorkflowBusyError } from './workflowActivity';

export const PROCESS_LEAD_QUEUE_NAME = 'process-lead-jobs';
const PROCESS_QUEUE_RESET_COUNT = 1000;

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

export async function enqueueProcessLeadJob(jobId: string, generation?: number) {
  const processQueue = getProcessLeadQueue();
  return processQueue.add(
    'process-leads',
    { jobId, generation },
    {
      jobId,
      attempts: 1,
      removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 }
    }
  );
}

export async function clearProcessQueueResetData(processQueue = getProcessLeadQueue()) {
  await processQueue.obliterate({
    force: false,
    count: PROCESS_QUEUE_RESET_COUNT
  });
}

export async function prepareProcessQueueForReset() {
  if (!isProcessQueueEnabled()) {
    return async () => {};
  }

  const processQueue = getProcessLeadQueue();
  await processQueue.pause();

  const activeCount = await processQueue.getActiveCount();
  if (activeCount > 0) {
    await processQueue.resume();
    throw createWorkflowBusyError();
  }

  await clearProcessQueueResetData(processQueue);

  return async () => {
    await processQueue.resume();
  };
}
