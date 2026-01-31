import { healthRoutes } from './health.js';
import { authRoutes } from './auth.routes.js';
import { userRoutes } from './user.routes.js';
import { masjidRoutes } from './masjid.routes.js';
import { scheduleRoutes } from './schedule.routes.js';
import { subscriptionRoutes } from './subscription.routes.js';
import { broadcastRoutes } from './broadcast.routes.js';
import { deviceRoutes } from './device.routes.js';

/**
 * Register application routes.
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerRoutes(fastify) {
  fastify.register(healthRoutes, { prefix: '/api/v1' });
  fastify.register(authRoutes, { prefix: '/api/v1/auth' });
  fastify.register(userRoutes, { prefix: '/api/v1/users' });
  fastify.register(masjidRoutes, { prefix: '/api/v1/masjids' });
  fastify.register(scheduleRoutes, { prefix: '/api/v1/schedules' });
  fastify.register(deviceRoutes, { prefix: '/api/v1/devices' });
  fastify.register(subscriptionRoutes, { prefix: '/api/v1/subscriptions' });
  fastify.register(broadcastRoutes, { prefix: '/api/v1/broadcasts' });
}
