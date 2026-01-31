import fp from 'fastify-plugin';
import { env } from '../config/env.js';
import { verifyAccessToken } from '../utils/jwt.js';

const ACCESS_COOKIE = 'accessToken';

/**
 * Simple auth hook that validates JWT access tokens from cookies or Authorization header.
 */
export default fp(async (fastify) => {
  fastify.decorateRequest('user', null);

  fastify.addHook('preHandler', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;
    const cookieToken = request.cookies?.[ACCESS_COOKIE];
    const token = bearer || cookieToken;

    if (!token) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Missing token' });
    }

    try {
      const payload = verifyAccessToken(token);
      request.user = payload;
    } catch (err) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Invalid token' });
    }
  });
});
