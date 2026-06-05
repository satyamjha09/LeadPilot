/**
 * Future BullMQ worker for background row scheduling.
 * Keep disabled until Redis is configured.
 */

// TODO: worker will process Calendar + Gmail + Sheet update
// TODO: retry failed Google API calls
// TODO: rate limit jobs

export function isWorkerEnabled() {
  return process.env.ENABLE_SCHEDULER_WORKER === 'true';
}
