/**
 * User validation schemas.
 */
import { z } from 'zod';

export const userIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().min(2).max(255).optional(),
  role: z.enum(['listener', 'masjid_admin', 'super_admin']).optional(),
});

export const updateCurrentUserBodySchema = z
  .object({
    email: z.string().email().max(255).optional(),
    password: z.string().min(8).max(128).optional(),
    currentPassword: z.string().min(8).max(128).optional(),
  })
  .refine((data) => {
    if (data.password && !data.currentPassword) return false;
    return true;
  }, {
    message: 'currentPassword is required to change password',
    path: ['currentPassword'],
  });
