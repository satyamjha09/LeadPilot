import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const PROCESS_LEAD_QUEUE_NAME = 'process-lead-jobs';

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

export async function enqueueProcessLeadJob(jobId: string) {
  const processQueue = getProcessLeadQueue();
  return processQueue.add(
    'process-leads',
    { jobId },
    {
      jobId,
      attempts: 1,
      removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 }
    }
  );
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
    const error = new Error('A lead workflow is currently running. Wait for it to finish before resetting.');
    (error as Error & { statusCode?: number }).statusCode = 409;
    throw error;
  }

  await processQueue.drain(true);

  return async () => {
    await processQueue.resume();
  };
}
