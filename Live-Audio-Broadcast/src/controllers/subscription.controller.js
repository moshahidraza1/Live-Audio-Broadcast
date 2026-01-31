// Subscription controller handlers.
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { masjids, subscriptions } from '../db/schema.js';
import { asyncHandler } from '../utils/async-handler.js';
import { ApiError } from '../utils/api-error.js';
import { ApiResponse } from '../utils/api-response.js';

// Subscribe to a masjid.
const subscribeMasjid = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const params = request.params;
  if (!params?.id) throw new ApiError(400, 'validation_error', 'Missing masjid id');
  const { id: masjidId } = params;

  const body = request.body;
  if (!body) throw new ApiError(400, 'validation_error', 'Missing request body');

  const { preferences, isMuted, muteUntil } = body;

  const [masjidRecord] = await db
    .select({ id: masjids.id, isApproved: masjids.isApproved, isActive: masjids.isActive })
    .from(masjids)
    .where(eq(masjids.id, masjidId))
    .limit(1);

  if (!masjidRecord) throw new ApiError(404, 'not_found', 'Masjid not found');
  if (!masjidRecord.isApproved || !masjidRecord.isActive) {
    throw new ApiError(403, 'forbidden', 'Masjid is not active');
  }

  const [existingSubscription] = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, actorId), eq(subscriptions.masjidId, masjidId)))
    .limit(1);

  if (existingSubscription) {
    throw new ApiError(409, 'conflict', 'Subscription already exists');
  }

  const [createdSubscription] = await db
    .insert(subscriptions)
    .values({
      userId: actorId,
      masjidId,
      preferences: preferences ?? {},
      isMuted: isMuted ?? false,
      muteUntil: muteUntil ? new Date(muteUntil) : null,
    })
    .returning({
      userId: subscriptions.userId,
      masjidId: subscriptions.masjidId,
      preferences: subscriptions.preferences,
      isMuted: subscriptions.isMuted,
      muteUntil: subscriptions.muteUntil,
      createdAt: subscriptions.createdAt,
      updatedAt: subscriptions.updatedAt,
    });

  return reply.status(201).send(new ApiResponse(201, 'Subscription created', createdSubscription));
});

// Update subscription preferences for a masjid.
const updateSubscription = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const params = request.params;
  if (!params?.id) throw new ApiError(400, 'validation_error', 'Missing masjid id');
  const { id: masjidId } = params;

  const body = request.body;
  if (!body) throw new ApiError(400, 'validation_error', 'Missing request body');

  const { preferences, isMuted, muteUntil } = body;

  const [existingSubscription] = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, actorId), eq(subscriptions.masjidId, masjidId)))
    .limit(1);

  if (!existingSubscription) {
    throw new ApiError(404, 'not_found', 'Subscription not found');
  }

  const [updatedSubscription] = await db
    .update(subscriptions)
    .set({
      preferences: preferences ?? {},
      isMuted: isMuted ?? false,
      muteUntil: muteUntil ? new Date(muteUntil) : null,
      updatedAt: new Date(),
    })
    .where(and(eq(subscriptions.userId, actorId), eq(subscriptions.masjidId, masjidId)))
    .returning({
      userId: subscriptions.userId,
      masjidId: subscriptions.masjidId,
      preferences: subscriptions.preferences,
      isMuted: subscriptions.isMuted,
      muteUntil: subscriptions.muteUntil,
      createdAt: subscriptions.createdAt,
      updatedAt: subscriptions.updatedAt,
    });

  return reply.status(200).send(new ApiResponse(200, 'Subscription updated', updatedSubscription));
});

// Unsubscribe from a masjid.
const unsubscribeMasjid = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const params = request.params;
  if (!params?.id) throw new ApiError(400, 'validation_error', 'Missing masjid id');
  const { id: masjidId } = params;

  await db
    .delete(subscriptions)
    .where(and(eq(subscriptions.userId, actorId), eq(subscriptions.masjidId, masjidId)));

  return reply.status(200).send(new ApiResponse(200, 'Unsubscribed'));
});

// List subscriptions for the current user.
const listSubscriptions = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const query = request.query ?? {};
  const { page = 1, limit = 25 } = query;
  const offset = (page - 1) * limit;

  const subscriptionList = await db
    .select({
      userId: subscriptions.userId,
      masjidId: subscriptions.masjidId,
      preferences: subscriptions.preferences,
      isMuted: subscriptions.isMuted,
      muteUntil: subscriptions.muteUntil,
      createdAt: subscriptions.createdAt,
      updatedAt: subscriptions.updatedAt,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, actorId))
    .orderBy(subscriptions.createdAt)
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db
    .select({ total: sql`count(*)`.mapWith(Number) })
    .from(subscriptions)
    .where(eq(subscriptions.userId, actorId));

  return reply.status(200).send(new ApiResponse(200, 'Subscriptions fetched', subscriptionList, {
    page,
    limit,
    total: totalRow?.total ?? 0,
  }));
});

export {
  subscribeMasjid,
  updateSubscription,
  unsubscribeMasjid,
  listSubscriptions,
};
