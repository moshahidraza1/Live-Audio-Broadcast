import authMiddleware from '../middleware/auth.middleware.js';
import { validateRequest } from '../middleware/validation.middleware.js';
import {
  deviceIdParamsSchema,
  deviceRegisterBodySchema,
  deviceUpdateBodySchema,
} from '../validators/device.validator.js';
import {
  registerDevice,
  updateDevice,
  removeDevice,
} from '../controllers/device.controller.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function deviceRoutes(fastify) {
  fastify.register(authMiddleware);

  fastify.post(
    '/',
    { preHandler: validateRequest({ body: deviceRegisterBodySchema }) },
    registerDevice,
  );

  fastify.patch(
    '/:deviceId',
    { preHandler: validateRequest({ params: deviceIdParamsSchema, body: deviceUpdateBodySchema }) },
    updateDevice,
  );

  fastify.delete(
    '/:deviceId',
    { preHandler: validateRequest({ params: deviceIdParamsSchema }) },
    removeDevice,
  );
}
