// Auth validation schemas

import { z } from 'zod';

export const registerBodySchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

export const loginBodySchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  deviceId: z.string().min(3).max(128).optional(),
});

export const googleLoginBodySchema = z.object({
  idToken: z.string().min(10),
  deviceId: z.string().min(3).max(128).optional(),
});