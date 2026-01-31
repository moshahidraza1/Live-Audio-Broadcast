import authMiddleware from '../middleware/auth.middleware.js';
import { validateRequest } from '../middleware/validation.middleware.js';
import {
  masjidIdParamsSchema,
  masjidListQuerySchema,
  masjidRegistrationBodySchema,
  masjidRequestDecisionBodySchema,
  masjidRequestIdParamsSchema,
  pendingMasjidRequestQuerySchema,
  masjidStaffBodySchema,
  masjidStaffParamsSchema,
  masjidUpdateBodySchema,
} from '../validators/masjid.validator.js';
import {
  approveMasjidRequest,
  createMasjid,
  deleteMasjidStaff,
  getMasjid,
  listPendingMasjidRequests,
  listMasjids,
  rejectMasjidRequest,
  updateMasjid,
  upsertMasjidStaff,
} from '../controllers/masjid.controller.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function masjidRoutes(fastify) {
  fastify.get(
    '/',
    { preHandler: validateRequest({ query: masjidListQuerySchema }) },
    listMasjids,
  );

  fastify.get(
    '/:id',
    { preHandler: validateRequest({ params: masjidIdParamsSchema }) },
    getMasjid,
  );

  fastify.register(async (secured) => {
    secured.register(authMiddleware);

    secured.post(
      '/requests',
      { preHandler: validateRequest({ body: masjidRegistrationBodySchema }) },
      createMasjid,
    );

    secured.get(
      '/requests/pending',
      { preHandler: validateRequest({ query: pendingMasjidRequestQuerySchema }) },
      listPendingMasjidRequests,
    );

    secured.patch(
      '/requests/:id/approve',
      { preHandler: validateRequest({ params: masjidRequestIdParamsSchema }) },
      approveMasjidRequest,
    );

    secured.patch(
      '/requests/:id/reject',
      {
        preHandler: validateRequest({
          params: masjidRequestIdParamsSchema,
          body: masjidRequestDecisionBodySchema,
        }),
      },
      rejectMasjidRequest,
    );

    secured.patch(
      '/:id',
      {
        preHandler: validateRequest({
          params: masjidIdParamsSchema,
          body: masjidUpdateBodySchema,
        }),
      },
      updateMasjid,
    );

    secured.put(
      '/:id/staff',
      {
        preHandler: validateRequest({
          params: masjidIdParamsSchema,
          body: masjidStaffBodySchema,
        }),
      },
      upsertMasjidStaff,
    );

    secured.delete(
      '/:id/staff/:role',
      { preHandler: validateRequest({ params: masjidStaffParamsSchema }) },
      deleteMasjidStaff,
    );
  });
}