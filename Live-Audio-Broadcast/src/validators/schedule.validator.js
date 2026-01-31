// Schedule validation schemas.
import { z } from 'zod';

export const masjidIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const scheduleIdParamsSchema = z.object({
  id: z.string().uuid(),
  scheduleId: z.string().uuid(),
});

export const scheduleListQuerySchema = z.object({
  date: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const scheduleCreateBodySchema = z.object({
  date: z.string(),
  prayerName: z.enum(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Juma']),
  adhanAtUtc: z.string().optional(),
  adhanTimeLocal: z.string().optional(),
  timezone: z.string().optional(),
  iqamahAtUtc: z.string().optional(),
  iqamahTimeLocal: z.string().optional(),
  khutbahAtUtc: z.string().optional(),
  khutbahTimeLocal: z.string().optional(),
  isJuma: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (!data.adhanAtUtc && !data.adhanTimeLocal) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['adhanAtUtc'],
      message: 'Provide adhanAtUtc or adhanTimeLocal',
    });
  }
});

export const scheduleUpdateBodySchema = z.object({
  adhanAtUtc: z.string().optional(),
  adhanTimeLocal: z.string().optional(),
  timezone: z.string().optional(),
  iqamahAtUtc: z.string().optional().nullable(),
  iqamahTimeLocal: z.string().optional().nullable(),
  khutbahAtUtc: z.string().optional().nullable(),
  khutbahTimeLocal: z.string().optional().nullable(),
  isJuma: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (data.adhanAtUtc === undefined && data.adhanTimeLocal === undefined && data.iqamahAtUtc === undefined && data.iqamahTimeLocal === undefined && data.khutbahAtUtc === undefined && data.khutbahTimeLocal === undefined && data.isJuma === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['adhanAtUtc'],
      message: 'Provide at least one field to update',
    });
  }
});

export const scheduleBulkBodySchema = z.object({
  schedules: z.array(scheduleCreateBodySchema).min(1).max(20),
});

export const scheduleTemplateBodySchema = z.object({
  prayerName: z.enum(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Juma']),
  adhanTimeLocal: z.string(),
  iqamahTimeLocal: z.string().optional().nullable(),
  khutbahTimeLocal: z.string().optional().nullable(),
  timezone: z.string().optional(),
  isJuma: z.boolean().optional(),
});