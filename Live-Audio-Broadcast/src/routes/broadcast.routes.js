import authMiddleware from '../middleware/auth.middleware.js';
import { validateRequest } from '../middleware/validation.middleware.js';
import {
  broadcastCreateBodySchema,
  broadcastEndBodySchema,
  broadcastIdParamsSchema,
  broadcastStartBodySchema,
  broadcastListQuerySchema,
} from '../validators/broadcast.validator.js';
import {
  createBroadcast,
  listBroadcasts,
  startBroadcast,
  endBroadcast,
  getBroadcastToken,
  getBroadcastListenerToken,
  getHlsAsset,
} from '../controllers/broadcast.controller.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function broadcastRoutes(fastify) {
  fastify.get('/:id/hls/:file', getHlsAsset);

  fastify.register(authMiddleware);

  fastify.post(
    '/',
    { preHandler: validateRequest({ body: broadcastCreateBodySchema }) },
    createBroadcast,
  );

  fastify.get(
    '/',
    { preHandler: validateRequest({ query: broadcastListQuerySchema }) },
    listBroadcasts,
  );

  fastify.post(
    '/:id/start',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: validateRequest({ params: broadcastIdParamsSchema, body: broadcastStartBodySchema }),
    },
    startBroadcast,
  );

  fastify.post(
    '/:id/token',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: validateRequest({ params: broadcastIdParamsSchema }),
    },
    getBroadcastToken,
  );

  fastify.post(
    '/:id/listener-token',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      preHandler: validateRequest({ params: broadcastIdParamsSchema }),
    },
    getBroadcastListenerToken,
  );

  fastify.post(
    '/:id/end',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: validateRequest({ params: broadcastIdParamsSchema, body: broadcastEndBodySchema }),
    },
    endBroadcast,
  );
}