import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { ApiError } from '../utils/api-error.js';
import { ApiResponse } from '../utils/api-response.js';

/**
 * Attaches a consistent error handler with sanitized output.
 */
export default fp(async (fastify) => {
  fastify.setErrorHandler((err, request, reply) => {
    if (err instanceof ZodError) {
      const issues = err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      reply.status(400).send(new ApiResponse(400, 'Validation failed', null, { issues }));
      return;
    }

    if (err instanceof ApiError) {
      reply.status(err.statusCode).send(new ApiResponse(err.statusCode, err.message, null, {
        code: err.code,
        details: err.details,
      }));
      return;
    }

    const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    fastify.log.error({ err, req: request.id }, 'Request failed');

    reply.status(statusCode).send(new ApiResponse(
      statusCode,
      statusCode === 500 ? 'Internal server error' : err.message,
      null,
      { code: statusCode === 500 ? 'internal_error' : err.code || 'error' },
    ));
  });
});
