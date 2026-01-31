import { validateRequest } from '../middleware/validation.middleware.js';
import {
  registerBodySchema,
  loginBodySchema,
  googleLoginBodySchema,
} from '../validators/auth.validator.js';
import {
  registerUser,
  loginUser,
  refreshSession,
  logoutUser,
  googleLogin,
} from '../controllers/auth.controller.js';


export async function authRoutes(fastify) {
  fastify.post(
    '/register',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: validateRequest({ body: registerBodySchema }),
    },
    registerUser,
  );

  fastify.post(
    '/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: validateRequest({ body: loginBodySchema }),
    },
    loginUser,
  );

  fastify.post(
    '/google',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: validateRequest({ body: googleLoginBodySchema }),
    },
    googleLogin,
  );

  fastify.post(
    '/refresh',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    refreshSession,
  );
  fastify.post(
    '/logout',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    logoutUser,
  );
}