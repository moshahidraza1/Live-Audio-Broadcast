import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { loggerOptions } from './config/logger.js';
import { redis } from './config/redis.js';
import { pgPool } from './db/client.js';
import registerErrorHandler from './middleware/error-handler.middleware.js';
import { registerRoutes } from './routes/app.routes.js';

const fastify = Fastify({
  logger: loggerOptions,
  trustProxy: true,
});

await fastify.register(cookie, {
  secret: env.JWT_REFRESH_SECRET,
  hook: 'onRequest',
});

const corsOrigins = env.CORS_ORIGINS
  ? env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];

await fastify.register(cors, {
  origin: corsOrigins.length
    ? (origin, cb) => {
        if (!origin || corsOrigins.includes(origin)) {
          cb(null, true);
          return;
        }
        cb(new Error('Not allowed by CORS'), false);
      }
    : false,
  credentials: true,
});

await fastify.register(helmet, { global: true });

await fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  redis,
  hook: 'onSend',
  continueExceeding: false,
});

fastify.addHook('onRequest', async (request, reply) => {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

  const authHeader = request.headers.authorization;
  const hasBearer = authHeader?.startsWith('Bearer ');
  const hasCookieAuth = Boolean(request.cookies?.accessToken || request.cookies?.refreshToken);

  if (hasBearer || !hasCookieAuth) return;

  const csrfCookie = request.cookies?.[env.CSRF_COOKIE_NAME];
  const csrfHeader = request.headers['x-csrf-token'];

  if (!csrfCookie || !csrfHeader || csrfHeader !== csrfCookie) {
    return reply.status(403).send({ error: 'forbidden', message: 'Invalid CSRF token' });
  }
});

await fastify.register(registerErrorHandler);
await fastify.register(registerRoutes);

/**
 * Start the HTTP server.
 */
async function start() {
  try {
    await fastify.listen({ port: env.PORT, host: '0.0.0.0' });
    fastify.log.info({ port: env.PORT, env: env.NODE_ENV }, 'Server started');
  } catch (err) {
    fastify.log.error({ err }, 'Server failed to start');
    process.exit(1);
  }
}

const close = async () => {
  fastify.log.info('Shutting down');
  await fastify.close();
  await redis.quit();
  await pgPool.end();
};

process.on('SIGINT', close);
process.on('SIGTERM', close);

start();
