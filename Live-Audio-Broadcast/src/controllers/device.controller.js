// Device controller handlers.
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { userDevices } from '../db/schema.js';
import { asyncHandler } from '../utils/async-handler.js';
import { ApiError } from '../utils/api-error.js';
import { ApiResponse } from '../utils/api-response.js';

// Register or update a device token.
export const registerDevice = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const body = request.body;
  if (!body) throw new ApiError(400, 'validation_error', 'Missing request body');

  const {
    deviceId,
    fcmToken,
    voipToken,
    platform,
    isWakeOnSilentEnabled,
    isActive,
  } = body;

  if (fcmToken) {
    const [tokenOwner] = await db
      .select({ userId: userDevices.userId })
      .from(userDevices)
      .where(eq(userDevices.fcmToken, fcmToken))
      .limit(1);

    if (tokenOwner && tokenOwner.userId !== actorId) {
      throw new ApiError(409, 'conflict', 'Token already registered to another user');
    }
  }

  if (voipToken) {
    const [voipOwner] = await db
      .select({ userId: userDevices.userId })
      .from(userDevices)
      .where(eq(userDevices.voipToken, voipToken))
      .limit(1);

    if (voipOwner && voipOwner.userId !== actorId) {
      throw new ApiError(409, 'conflict', 'VoIP token already registered to another user');
    }
  }

  const [existingDevice] = await db
    .select({ id: userDevices.id })
    .from(userDevices)
    .where(and(eq(userDevices.userId, actorId), eq(userDevices.deviceId, deviceId)))
    .limit(1);

  let deviceRecord;

  if (existingDevice) {
    [deviceRecord] = await db
      .update(userDevices)
      .set({
        fcmToken: fcmToken ?? null,
        voipToken: voipToken ?? null,
        platform,
        isWakeOnSilentEnabled: isWakeOnSilentEnabled ?? true,
        isActive: isActive ?? true,
        lastActiveAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userDevices.id, existingDevice.id))
      .returning({
        id: userDevices.id,
        userId: userDevices.userId,
        deviceId: userDevices.deviceId,
        fcmToken: userDevices.fcmToken,
        voipToken: userDevices.voipToken,
        platform: userDevices.platform,
        isWakeOnSilentEnabled: userDevices.isWakeOnSilentEnabled,
        isActive: userDevices.isActive,
        lastActiveAt: userDevices.lastActiveAt,
        updatedAt: userDevices.updatedAt,
      });
  } else {
    [deviceRecord] = await db
      .insert(userDevices)
      .values({
        userId: actorId,
        deviceId,
        fcmToken: fcmToken ?? null,
        voipToken: voipToken ?? null,
        platform,
        isWakeOnSilentEnabled: isWakeOnSilentEnabled ?? true,
        isActive: isActive ?? true,
        lastActiveAt: new Date(),
      })
      .returning({
        id: userDevices.id,
        userId: userDevices.userId,
        deviceId: userDevices.deviceId,
        fcmToken: userDevices.fcmToken,
        voipToken: userDevices.voipToken,
        platform: userDevices.platform,
        isWakeOnSilentEnabled: userDevices.isWakeOnSilentEnabled,
        isActive: userDevices.isActive,
        lastActiveAt: userDevices.lastActiveAt,
        createdAt: userDevices.createdAt,
      });
  }

  return reply.status(200).send(new ApiResponse(200, 'Device registered', deviceRecord));
});

// Update device metadata.
export const updateDevice = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const params = request.params;
  if (!params?.deviceId) throw new ApiError(400, 'validation_error', 'Missing device id');
  const { deviceId } = params;

  const body = request.body;
  if (!body) throw new ApiError(400, 'validation_error', 'Missing request body');

  const { fcmToken, voipToken, platform, isWakeOnSilentEnabled, isActive } = body;

  if (fcmToken) {
    const [tokenOwner] = await db
      .select({ userId: userDevices.userId })
      .from(userDevices)
      .where(eq(userDevices.fcmToken, fcmToken))
      .limit(1);

    if (tokenOwner && tokenOwner.userId !== actorId) {
      throw new ApiError(409, 'conflict', 'Token already registered to another user');
    }
  }

  if (voipToken) {
    const [voipOwner] = await db
      .select({ userId: userDevices.userId })
      .from(userDevices)
      .where(eq(userDevices.voipToken, voipToken))
      .limit(1);

    if (voipOwner && voipOwner.userId !== actorId) {
      throw new ApiError(409, 'conflict', 'VoIP token already registered to another user');
    }
  }

  const [existingDevice] = await db
    .select({ id: userDevices.id })
    .from(userDevices)
    .where(and(eq(userDevices.userId, actorId), eq(userDevices.deviceId, deviceId)))
    .limit(1);

  if (!existingDevice) throw new ApiError(404, 'not_found', 'Device not found');

  const [updatedDevice] = await db
    .update(userDevices)
    .set({
      fcmToken: fcmToken ?? undefined,
      voipToken: voipToken ?? undefined,
      platform: platform ?? undefined,
      isWakeOnSilentEnabled: isWakeOnSilentEnabled ?? undefined,
      isActive: isActive ?? undefined,
      lastActiveAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(userDevices.id, existingDevice.id))
    .returning({
      id: userDevices.id,
      userId: userDevices.userId,
      deviceId: userDevices.deviceId,
      fcmToken: userDevices.fcmToken,
      voipToken: userDevices.voipToken,
      platform: userDevices.platform,
      isWakeOnSilentEnabled: userDevices.isWakeOnSilentEnabled,
      isActive: userDevices.isActive,
      lastActiveAt: userDevices.lastActiveAt,
      updatedAt: userDevices.updatedAt,
    });

  return reply.status(200).send(new ApiResponse(200, 'Device updated', updatedDevice));
});

// Remove a device registration.
export const removeDevice = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const params = request.params;
  if (!params?.deviceId) throw new ApiError(400, 'validation_error', 'Missing device id');
  const { deviceId } = params;

  const [existingDevice] = await db
    .select({ id: userDevices.id })
    .from(userDevices)
    .where(and(eq(userDevices.userId, actorId), eq(userDevices.deviceId, deviceId)))
    .limit(1);

  if (!existingDevice) throw new ApiError(404, 'not_found', 'Device not found');

  await db.delete(userDevices).where(eq(userDevices.id, existingDevice.id));

  return reply.status(200).send(new ApiResponse(200, 'Device removed'));
});
