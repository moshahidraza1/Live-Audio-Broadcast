/**
 * Health controller handlers.
 */

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<void>}
 */
export async function healthCheck(request, reply) {
  return reply.status(200).send({ status: 'ok' });
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<void>}
 */

export async function readinessCheck(request, reply) {
  return reply.status(200).send({ status: 'ready' });
}
