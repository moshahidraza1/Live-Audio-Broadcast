import { pgPool } from '../db/client.js';
import { redis } from '../config/redis.js';

/**
 * Health and readiness endpoints.
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function healthRoutes(fastify) {
  fastify.get('/health', async () => ({ status: 'ok' }));
  fastify.get('/readiness', async () => {
    const checks = {
      database: 'unknown',
      redis: 'unknown',
    };

    try {
      await pgPool.query('SELECT 1');
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    }

    try {
      await redis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
    }

    const isReady = Object.values(checks).every((value) => value === 'ok');
    return {
      status: isReady ? 'ready' : 'not_ready',
      checks,
    };
  });
}
