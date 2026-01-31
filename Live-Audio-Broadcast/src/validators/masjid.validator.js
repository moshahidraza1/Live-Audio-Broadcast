/**
 * Masjid validation schemas.
 */
import { z } from 'zod';

export const masjidIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const masjidRequestIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const masjidListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().min(2).max(255).optional(),
  city: z.string().min(2).max(100).optional(),
  country: z.string().min(2).max(100).optional(),
  approved: z.union([z.boolean(), z.string()]).optional(),
  active: z.union([z.boolean(), z.string()]).optional(),
  ownerId: z.string().uuid().optional(),
});

export const pendingMasjidRequestQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().min(2).max(255).optional(),
});

export const masjidRegistrationBodySchema = z.object({
  name: z.string().min(2).max(255),
  description: z.string().max(2000).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  timezone: z.string().min(3).max(64).optional(),
  contactEmail: z.string().email().max(255).optional(),
  contactPhone: z.string().max(32).optional(),
  logoUrl: z.string().url().optional(),
  imamName: z.string().max(255).optional(),
  imamEmail: z.string().email().max(255).optional(),
  imamPhone: z.string().max(32).optional(),
  muazzinName: z.string().max(255).optional(),
  muazzinEmail: z.string().email().max(255).optional(),
  muazzinPhone: z.string().max(32).optional(),
});

export const masjidUpdateBodySchema = z.object({
  name: z.string().min(2).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  timezone: z.string().min(3).max(64).optional(),
  contactEmail: z.string().email().max(255).optional().nullable(),
  contactPhone: z.string().max(32).optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
  isApproved: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const masjidRequestDecisionBodySchema = z.object({
  reason: z.string().max(2000).optional(),
});

export const masjidStaffBodySchema = z.object({
  role: z.enum(['imam', 'muazzin']),
  name: z.string().min(2).max(255),
  email: z.string().email().max(255).optional(),
  phone: z.string().max(32).optional(),
  isActive: z.boolean().optional(),
});

export const masjidStaffParamsSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['imam', 'muazzin']),
});