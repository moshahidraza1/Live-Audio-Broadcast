/**
 * Async handler to forward errors to Fastify error handler.
 * @param {(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>} fn
 * @returns {(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>}
 */
export function asyncHandler(fn) {
  return async (request, reply) => {
    try {
      return await fn(request, reply);
    } catch (err) {
      throw err;
    }
  };
}