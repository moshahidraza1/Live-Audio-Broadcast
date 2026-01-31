import authMiddleware from '../middleware/auth.middleware.js';
import { validateRequest } from '../middleware/validation.middleware.js';
import {
  masjidIdParamsSchema,
  subscribeBodySchema,
  subscriptionListQuerySchema,
} from '../validators/subscription.validator.js';
import {
  subscribeMasjid,
  updateSubscription,
  unsubscribeMasjid,
  listSubscriptions,
} from '../controllers/subscription.controller.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function subscriptionRoutes(fastify) {
  fastify.register(authMiddleware);

  fastify.post(
    '/:id',
    { preHandler: validateRequest({ params: masjidIdParamsSchema, body: subscribeBodySchema }) },
    subscribeMasjid,
  );

  fastify.patch(
    '/:id',
    { preHandler: validateRequest({ params: masjidIdParamsSchema, body: subscribeBodySchema }) },
    updateSubscription,
  );

  fastify.delete(
    '/:id',
    { preHandler: validateRequest({ params: masjidIdParamsSchema }) },
    unsubscribeMasjid,
  );

  fastify.get(
    '/',
    { preHandler: validateRequest({ query: subscriptionListQuerySchema }) },
    listSubscriptions,
  );
}