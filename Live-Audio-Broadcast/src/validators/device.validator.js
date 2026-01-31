import { z } from 'zod';

export const deviceIdParamsSchema = z.object({
  deviceId: z.string().min(3).max(128),
});

export const deviceRegisterBodySchema = z
  .object({
    deviceId: z.string().min(3).max(128),
    fcmToken: z.string().min(10).optional(),
    voipToken: z.string().min(10).optional(),
    platform: z.enum(['android', 'ios', 'web']),
    isWakeOnSilentEnabled: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if ((data.platform === 'android' || data.platform === 'web') && !data.fcmToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fcmToken is required for android/web',
        path: ['fcmToken'],
      });
    }
    if (data.platform === 'ios' && !data.voipToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'voipToken is required for ios',
        path: ['voipToken'],
      });
    }
  });

export const deviceUpdateBodySchema = z.object({
  fcmToken: z.string().min(10).optional(),
  voipToken: z.string().min(10).optional(),
  platform: z.enum(['android', 'ios', 'web']).optional(),
  isWakeOnSilentEnabled: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
