// Subscription validation schemas.
import { z } from 'zod';

export const masjidIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const subscriptionPreferencesSchema = z.object({
  mutedPrayers: z.array(z.enum(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Juma'])).optional(),
  wakeOnSilent: z.boolean().optional(),
});

export const subscribeBodySchema = z.object({
  preferences: subscriptionPreferencesSchema.optional(),
  isMuted: z.boolean().optional(),
  muteUntil: z.string().optional(),
});

export const subscriptionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});