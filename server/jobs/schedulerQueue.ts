/**
 * Future Redis + BullMQ queue entry point.
 * Not wired into HTTP handlers yet — scheduling still runs inline in server.ts.
 */

// TODO: initialize BullMQ queue with Redis connection
// TODO: add one job per row
// TODO: store job status in DB

export const SCHEDULER_QUEUE_NAME = 'excel-meet-scheduler';

export function isQueueEnabled() {
  return process.env.ENABLE_SCHEDULER_QUEUE === 'true';
}
