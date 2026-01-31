import { validateRequest } from '../middleware/validation.middleware.js';
import {
  listUsersQuerySchema,
  updateCurrentUserBodySchema,
  userIdParamsSchema,
} from '../validators/user.validator.js';
import {
  getCurrentUser,
  updateCurrentUser,
  listUsers,
  getUserById,
} from '../controllers/user.controller.js';
import authMiddleware from '../middleware/auth.middleware.js';


export async function userRoutes(fastify) {
  fastify.register(authMiddleware);

  fastify.get('/me', getCurrentUser);

  fastify.patch(
    '/me',
    { preHandler: validateRequest({ body: updateCurrentUserBodySchema }) },
    updateCurrentUser,
  );

  fastify.get(
    '/',
    { preHandler: validateRequest({ query: listUsersQuerySchema }) },
    listUsers,
  );

  fastify.get(
    '/:id',
    { preHandler: validateRequest({ params: userIdParamsSchema }) },
    getUserById,
  );
}