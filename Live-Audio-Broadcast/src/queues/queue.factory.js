import { Queue, Worker } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { redis } from '../config/redis.js';

const connection = redis.duplicate();

export const notificationQueue = new Queue('notifications', { connection });
export const broadcastQueue = new Queue('broadcasts', { connection });

/**
 * Creates a worker with shared connection and logging.
 * @param {string} name
 * @param {(job: import('bullmq').Job) => Promise<void>} handler
 * @returns {Worker}
 */
export function createWorker(name, handler) {
  const worker = new Worker(name, handler, { connection });

  worker.on('error', (err) => logger.error({ err, queue: name }, 'Worker error'));
  worker.on('failed', (job, err) => logger.error({ err, jobId: job?.id, queue: name }, 'Job failed'));
  worker.on('completed', (job) => logger.info({ jobId: job.id, queue: name }, 'Job completed'));

  return worker;
}

export function closeQueues() {
  return Promise.all([notificationQueue.close(), broadcastQueue.close(), connection.quit()]);
}

logger.info({ redis: env.REDIS_URL }, 'Queues initialized');
