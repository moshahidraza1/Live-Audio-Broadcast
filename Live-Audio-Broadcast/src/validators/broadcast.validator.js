// Broadcast validation schemas.
import { z } from 'zod';

export const broadcastIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const broadcastCreateBodySchema = z.object({
  masjidId: z.string().uuid(),
  title: z.string().max(255).optional(),
  prayerName: z.enum(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Juma']).optional(),
  scheduledAt: z.string().optional(),
  streamProvider: z.string().max(64).optional(),
  streamRoomId: z.string().max(255).optional(),
  audioUrl: z.string().url().optional(),
});

export const broadcastStartBodySchema = z.object({
  streamProvider: z.string().max(64).optional(),
  streamRoomId: z.string().max(255).optional(),
  audioUrl: z.string().url().optional(),
});

export const broadcastEndBodySchema = z.object({
  recordingUrl: z.string().url().optional(),
  endedReason: z.string().max(255).optional(),
});

export const broadcastListQuerySchema = z.object({
  masjidId: z.string().uuid(),
  date: z.string().optional(),
  status: z.enum(['pending', 'scheduled', 'live', 'completed', 'failed']).optional(),
  prayerName: z.enum(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Juma']).optional(),
});