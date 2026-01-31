import authMiddleware from '../middleware/auth.middleware.js';
import { validateRequest } from '../middleware/validation.middleware.js';
import {
  masjidIdParamsSchema,
  scheduleIdParamsSchema,
  scheduleListQuerySchema,
  scheduleCreateBodySchema,
  scheduleUpdateBodySchema,
  scheduleBulkBodySchema,
  scheduleTemplateBodySchema,
} from '../validators/schedule.validator.js';
import {
  createSchedule,
  upsertScheduleTemplate,
  upsertSchedules,
  updateSchedule,
  listSchedules,
} from '../controllers/schedule.controller.js';


export async function scheduleRoutes(fastify) {
  fastify.get(
    '/:id',
    { preHandler: validateRequest({ params: masjidIdParamsSchema, query: scheduleListQuerySchema }) },
    listSchedules,
  );

  fastify.register(async (secured) => {
    secured.register(authMiddleware);

    secured.post(
      '/:id',
      { preHandler: validateRequest({ params: masjidIdParamsSchema, body: scheduleCreateBodySchema }) },
      createSchedule,
    );

    secured.post(
      '/:id/template',
      { preHandler: validateRequest({ params: masjidIdParamsSchema, body: scheduleTemplateBodySchema }) },
      upsertScheduleTemplate,
    );

    secured.post(
      '/:id/bulk',
      { preHandler: validateRequest({ params: masjidIdParamsSchema, body: scheduleBulkBodySchema }) },
      upsertSchedules,
    );

    secured.patch(
      '/:id/:scheduleId',
      { preHandler: validateRequest({ params: scheduleIdParamsSchema, body: scheduleUpdateBodySchema }) },
      updateSchedule,
    );
  });
}