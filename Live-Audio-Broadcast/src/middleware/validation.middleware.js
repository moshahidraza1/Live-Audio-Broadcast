/**
 * Validation middleware for Fastify routes using Zod.
 */

/**
 * @typedef {object} ValidationSchemas
 * @property {import('zod').ZodSchema | undefined} [body]
 * @property {import('zod').ZodSchema | undefined} [query]
 * @property {import('zod').ZodSchema | undefined} [params]
 */

/**
 * @param {ValidationSchemas} schemas
 * @returns {(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>}
 */
export function validateRequest(schemas) {
  return async (request, reply) => {
    const validated = {};

    if (schemas.body) {
      validated.body = schemas.body.parse(request.body ?? {});
      request.body = validated.body;
    }

    if (schemas.query) {
      validated.query = schemas.query.parse(request.query ?? {});
      request.query = validated.query;
    }

    if (schemas.params) {
      validated.params = schemas.params.parse(request.params ?? {});
      request.params = validated.params;
    }

    request.validated = validated;
  };
}
