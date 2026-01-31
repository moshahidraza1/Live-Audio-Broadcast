// Broadcast controller handlers.
import { and, eq, gte, lt, ne, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { broadcasts, masjidAdmins, masjids, subscriptions } from '../db/schema.js';
import { broadcastQueue, notificationQueue } from '../queues/queue.factory.js';
import { env } from '../config/env.js';
import { createLivekitToken, ensureLivekitRoom, getLivekitConfigStatus, getLivekitUrl } from '../services/livekit.js';
import { isHlsEnabled, signHlsUrl, verifyHlsSignature } from '../services/hls.js';
import { asyncHandler } from '../utils/async-handler.js';
import { ApiError } from '../utils/api-error.js';
import { ApiResponse } from '../utils/api-response.js';
import { verifyAccessToken } from '../utils/jwt.js';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_BROADCAST_MAX_MINUTES = 15;

function getBroadcastMaxMinutes() {
  const parsed = Number(env.BROADCAST_MAX_MINUTES);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_BROADCAST_MAX_MINUTES;
}

function isBroadcastExpired(startedAt) {
  if (!startedAt) return false;
  const maxMinutes = getBroadcastMaxMinutes();
  const elapsedMs = Date.now() - startedAt.getTime();
  return elapsedMs >= maxMinutes * 60 * 1000;
}

async function markBroadcastExpired(broadcastId, endedReason = 'max_duration_reached') {
  const [updatedBroadcast] = await db
    .update(broadcasts)
    .set({
      status: 'completed',
      endedAt: new Date(),
      endedReason,
      updatedAt: new Date(),
    })
    .where(eq(broadcasts.id, broadcastId))
    .returning({ id: broadcasts.id, masjidId: broadcasts.masjidId });

  if (updatedBroadcast) {
    await notificationQueue.add('broadcast-end', {
      broadcastId: updatedBroadcast.id,
      masjidId: updatedBroadcast.masjidId,
    });
  }
}

// Check if the user can manage broadcasts for a masjid.
async function requireMasjidAuthority(actorId, masjidId) {
  const [adminRecord] = await db
    .select({ role: masjidAdmins.role })
    .from(masjidAdmins)
    .where(and(eq(masjidAdmins.userId, actorId), eq(masjidAdmins.masjidId, masjidId)))
    .limit(1);

  if (!adminRecord) {
    throw new ApiError(403, 'forbidden', 'Insufficient privileges');
  }
}

async function assertMasjidAccess(actorId, masjidId) {
  const [adminRecord] = await db
    .select({ userId: masjidAdmins.userId })
    .from(masjidAdmins)
    .where(and(eq(masjidAdmins.userId, actorId), eq(masjidAdmins.masjidId, masjidId)))
    .limit(1);

  if (adminRecord) return;

  const [subscription] = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, actorId), eq(subscriptions.masjidId, masjidId)))
    .limit(1);

  if (!subscription) {
    throw new ApiError(403, 'forbidden', 'Subscription required');
  }
}

const listBroadcasts = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const query = request.query ?? {};
  const { masjidId, date, status, prayerName } = query;
  if (!masjidId) throw new ApiError(400, 'validation_error', 'Missing masjidId');

  await assertMasjidAccess(actorId, masjidId);

  const filters = [eq(broadcasts.masjidId, masjidId)];
  if (status) filters.push(eq(broadcasts.status, status));
  if (prayerName) filters.push(eq(broadcasts.prayerName, prayerName));

  if (date) {
    const day = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime())) {
      throw new ApiError(400, 'validation_error', 'Invalid date');
    }
    const end = new Date(day);
    end.setUTCDate(end.getUTCDate() + 1);
    filters.push(gte(broadcasts.scheduledAt, day));
    filters.push(lt(broadcasts.scheduledAt, end));
  }

  const items = await db
    .select({
      id: broadcasts.id,
      masjidId: broadcasts.masjidId,
      title: broadcasts.title,
      prayerName: broadcasts.prayerName,
      status: broadcasts.status,
      scheduledAt: broadcasts.scheduledAt,
      startedAt: broadcasts.startedAt,
      endedAt: broadcasts.endedAt,
      streamProvider: broadcasts.streamProvider,
      streamRoomId: broadcasts.streamRoomId,
      audioUrl: broadcasts.audioUrl,
      hlsUrl: broadcasts.hlsUrl,
    })
    .from(broadcasts)
    .where(and(...filters))
    .orderBy(broadcasts.scheduledAt);

  return reply.status(200).send(new ApiResponse(200, 'Broadcasts fetched', items));
});

// Create a broadcast entry.
const createBroadcast = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const body = request.body;
  if (!body) throw new ApiError(400, 'validation_error', 'Missing request body');

  const {
    masjidId,
    title,
    prayerName,
    scheduledAt,
    streamProvider,
    streamRoomId,
    audioUrl,
  } = body;

  const [masjidRecord] = await db
    .select({ id: masjids.id, isApproved: masjids.isApproved, isActive: masjids.isActive })
    .from(masjids)
    .where(eq(masjids.id, masjidId))
    .limit(1);

  if (!masjidRecord) throw new ApiError(404, 'not_found', 'Masjid not found');
  if (!masjidRecord.isApproved || !masjidRecord.isActive) {
    throw new ApiError(403, 'forbidden', 'Masjid is not active');
  }

  await requireMasjidAuthority(actorId, masjidId);

  if (prayerName && scheduledAt) {
    const scheduledDate = new Date(scheduledAt);
    if (Number.isNaN(scheduledDate.getTime())) {
      throw new ApiError(400, 'validation_error', 'Invalid scheduledAt');
    }

    const startOfDay = new Date(
      Date.UTC(
        scheduledDate.getUTCFullYear(),
        scheduledDate.getUTCMonth(),
        scheduledDate.getUTCDate(),
        0,
        0,
        0
      )
    );
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

    const [existingBroadcast] = await db
      .select({ id: broadcasts.id, status: broadcasts.status })
      .from(broadcasts)
      .where(
        and(
          eq(broadcasts.masjidId, masjidId),
          eq(broadcasts.prayerName, prayerName),
          ne(broadcasts.status, 'failed'),
          or(
            and(gte(broadcasts.scheduledAt, startOfDay), lt(broadcasts.scheduledAt, endOfDay)),
            and(gte(broadcasts.startedAt, startOfDay), lt(broadcasts.startedAt, endOfDay))
          )
        )
      )
      .limit(1);

    if (existingBroadcast) {
      throw new ApiError(409, 'conflict', 'Broadcast already exists for this prayer and date');
    }
  }

  const resolvedProvider = streamProvider ?? 'livekit';

  const [createdBroadcast] = await db
    .insert(broadcasts)
    .values({
      masjidId,
      createdBy: actorId,
      title: title ?? null,
      prayerName: prayerName ?? null,
      status: scheduledAt ? 'scheduled' : 'pending',
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      streamProvider: resolvedProvider,
      streamRoomId: streamRoomId ?? null,
      audioUrl: audioUrl ?? null,
    })
    .returning({
      id: broadcasts.id,
      masjidId: broadcasts.masjidId,
      createdBy: broadcasts.createdBy,
      title: broadcasts.title,
      prayerName: broadcasts.prayerName,
      startedAt: broadcasts.startedAt,
      status: broadcasts.status,
      scheduledAt: broadcasts.scheduledAt,
      streamProvider: broadcasts.streamProvider,
      streamRoomId: broadcasts.streamRoomId,
      audioUrl: broadcasts.audioUrl,
      createdAt: broadcasts.createdAt,
      updatedAt: broadcasts.updatedAt,
    });

  let broadcastPayload = createdBroadcast;

  if (resolvedProvider === 'livekit' && !createdBroadcast.streamRoomId && getLivekitUrl()) {
    const roomName = `broadcast-${createdBroadcast.id}`;
    await ensureLivekitRoom(roomName);

    const [updatedBroadcast] = await db
      .update(broadcasts)
      .set({
        streamRoomId: roomName,
        audioUrl: createdBroadcast.audioUrl ?? getLivekitUrl(),
        updatedAt: new Date(),
      })
      .where(eq(broadcasts.id, createdBroadcast.id))
      .returning({
        id: broadcasts.id,
        masjidId: broadcasts.masjidId,
        createdBy: broadcasts.createdBy,
        title: broadcasts.title,
        prayerName: broadcasts.prayerName,
        status: broadcasts.status,
        scheduledAt: broadcasts.scheduledAt,
        streamProvider: broadcasts.streamProvider,
        streamRoomId: broadcasts.streamRoomId,
        audioUrl: broadcasts.audioUrl,
        createdAt: broadcasts.createdAt,
        updatedAt: broadcasts.updatedAt,
      });

    if (updatedBroadcast) {
      broadcastPayload = updatedBroadcast;
    }
  }

  return reply.status(201).send(new ApiResponse(201, 'Broadcast created', broadcastPayload));
});

// Start a broadcast and enqueue notifications.
const startBroadcast = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const params = request.params;
  if (!params?.id) throw new ApiError(400, 'validation_error', 'Missing broadcast id');
  const { id } = params;

  const body = request.body ?? {};
  const { streamProvider, streamRoomId, audioUrl } = body;

  const [broadcastRecord] = await db
    .select({
      id: broadcasts.id,
      masjidId: broadcasts.masjidId,
      status: broadcasts.status,
      prayerName: broadcasts.prayerName,
      streamProvider: broadcasts.streamProvider,
      streamRoomId: broadcasts.streamRoomId,
      audioUrl: broadcasts.audioUrl,
    })
    .from(broadcasts)
    .where(eq(broadcasts.id, id))
    .limit(1);

  if (!broadcastRecord) throw new ApiError(404, 'not_found', 'Broadcast not found');
  if (broadcastRecord.status === 'live') {
    if (isBroadcastExpired(broadcastRecord.startedAt)) {
      await markBroadcastExpired(broadcastRecord.id);
      throw new ApiError(409, 'conflict', 'Broadcast expired');
    }
    throw new ApiError(409, 'conflict', 'Broadcast already live');
  }
  if (broadcastRecord.status === 'completed') {
    throw new ApiError(409, 'conflict', 'Broadcast already ended');
  }

  await requireMasjidAuthority(actorId, broadcastRecord.masjidId);

  let resolvedRoomId = streamRoomId ?? broadcastRecord.streamRoomId ?? null;
  let resolvedProvider = streamProvider ?? broadcastRecord.streamProvider ?? 'livekit';
  let resolvedAudioUrl = audioUrl ?? broadcastRecord.audioUrl ?? null;

  if (!resolvedRoomId && resolvedProvider === 'livekit' && getLivekitUrl()) {
    const roomName = `broadcast-${broadcastRecord.id}`;
    await ensureLivekitRoom(roomName);
    resolvedRoomId = roomName;
    resolvedAudioUrl = resolvedAudioUrl ?? getLivekitUrl();
  }

  const [updatedBroadcast] = await db
    .update(broadcasts)
    .set({
      status: 'live',
      streamProvider: resolvedProvider ?? undefined,
      streamRoomId: resolvedRoomId ?? undefined,
      audioUrl: resolvedAudioUrl ?? undefined,
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(broadcasts.id, id))
    .returning({
      id: broadcasts.id,
      masjidId: broadcasts.masjidId,
      prayerName: broadcasts.prayerName,
      status: broadcasts.status,
      streamProvider: broadcasts.streamProvider,
      streamRoomId: broadcasts.streamRoomId,
      audioUrl: broadcasts.audioUrl,
      startedAt: broadcasts.startedAt,
      updatedAt: broadcasts.updatedAt,
    });

  await notificationQueue.add('broadcast-start', {
    broadcastId: updatedBroadcast.id,
    masjidId: updatedBroadcast.masjidId,
    prayerName: updatedBroadcast.prayerName,
  });

  if (isHlsEnabled() && resolvedRoomId) {
    await broadcastQueue.add('hls-start', {
      broadcastId: updatedBroadcast.id,
      roomName: resolvedRoomId,
    });
  }

  const maxMinutes = getBroadcastMaxMinutes();
  const delayMs = Math.max(1, maxMinutes) * 60 * 1000;

  await broadcastQueue.add(
    'broadcast-auto-end',
    { broadcastId: updatedBroadcast.id, endedReason: 'max_duration_reached' },
    { delay: delayMs, jobId: `broadcast-auto-end-${updatedBroadcast.id}` }
  );

  return reply.status(200).send(new ApiResponse(200, 'Broadcast started', updatedBroadcast));
});

// Create a broadcaster token for LiveKit.
const getBroadcastToken = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const params = request.params;
  if (!params?.id) throw new ApiError(400, 'validation_error', 'Missing broadcast id');
  const { id } = params;

  const [broadcastRecord] = await db
    .select({
      id: broadcasts.id,
      masjidId: broadcasts.masjidId,
      status: broadcasts.status,
      startedAt: broadcasts.startedAt,
      streamProvider: broadcasts.streamProvider,
      streamRoomId: broadcasts.streamRoomId,
      audioUrl: broadcasts.audioUrl,
      hlsUrl: broadcasts.hlsUrl,
    })
    .from(broadcasts)
    .where(eq(broadcasts.id, id))
    .limit(1);

  if (!broadcastRecord) throw new ApiError(404, 'not_found', 'Broadcast not found');
  if (broadcastRecord.status === 'live') {
    if (isBroadcastExpired(broadcastRecord.startedAt)) {
      await markBroadcastExpired(broadcastRecord.id);
      throw new ApiError(409, 'conflict', 'Broadcast expired');
    }
  } else {
    throw new ApiError(409, 'conflict', 'Broadcast is not live');
  }

  await requireMasjidAuthority(actorId, broadcastRecord.masjidId);

  const provider = broadcastRecord.streamProvider ?? 'livekit';
  let resolvedRoomId = broadcastRecord.streamRoomId;
  let resolvedAudioUrl = broadcastRecord.audioUrl ?? getLivekitUrl();

  if (!resolvedRoomId && provider === 'livekit' && getLivekitUrl()) {
    const roomName = `broadcast-${broadcastRecord.id}`;
    await ensureLivekitRoom(roomName);
    resolvedRoomId = roomName;

    await db
      .update(broadcasts)
      .set({
        streamRoomId: roomName,
        audioUrl: resolvedAudioUrl,
        updatedAt: new Date(),
      })
      .where(eq(broadcasts.id, broadcastRecord.id));
  }

  if (!resolvedRoomId) {
    throw new ApiError(500, 'configuration_error', 'LiveKit room not configured');
  }

  const token = await createLivekitToken({
    identity: actorId,
    roomName: resolvedRoomId,
    canPublish: true,
  });

  if (!token) {
    const configStatus = getLivekitConfigStatus();
    throw new ApiError(500, 'configuration_error', 'LiveKit credentials missing', configStatus);
  }

  return reply.status(200).send(
    new ApiResponse(200, 'Broadcast token issued', {
      token,
      roomName: resolvedRoomId,
      livekitUrl: resolvedAudioUrl,
    })
  );
});

// Create a listener token for LiveKit.
const getBroadcastListenerToken = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const params = request.params;
  if (!params?.id) throw new ApiError(400, 'validation_error', 'Missing broadcast id');
  const { id } = params;

  const [broadcastRecord] = await db
    .select({
      id: broadcasts.id,
      masjidId: broadcasts.masjidId,
      status: broadcasts.status,
      startedAt: broadcasts.startedAt,
      streamProvider: broadcasts.streamProvider,
      streamRoomId: broadcasts.streamRoomId,
      audioUrl: broadcasts.audioUrl,
    })
    .from(broadcasts)
    .where(eq(broadcasts.id, id))
    .limit(1);

  if (!broadcastRecord) throw new ApiError(404, 'not_found', 'Broadcast not found');
  if (broadcastRecord.status === 'live') {
    if (isBroadcastExpired(broadcastRecord.startedAt)) {
      await markBroadcastExpired(broadcastRecord.id);
      throw new ApiError(409, 'conflict', 'Broadcast expired');
    }
  } else {
    throw new ApiError(409, 'conflict', 'Broadcast is not live');
  }

  const [subscription] = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, actorId), eq(subscriptions.masjidId, broadcastRecord.masjidId)))
    .limit(1);

  if (!subscription) {
    throw new ApiError(403, 'forbidden', 'Subscription required');
  }

  if (isHlsEnabled()) {
    const signedUrl = signHlsUrl(broadcastRecord.id, '/api/v1');
    const hlsUrl = signedUrl ?? broadcastRecord.hlsUrl;
    if (!hlsUrl) {
      throw new ApiError(503, 'service_unavailable', 'HLS stream not ready');
    }

    return reply.status(200).send(
      new ApiResponse(200, 'Listener stream ready', {
        streamUrl: hlsUrl,
        format: 'hls',
      })
    );
  }

  const provider = broadcastRecord.streamProvider ?? 'livekit';
  let resolvedRoomId = broadcastRecord.streamRoomId;
  let resolvedAudioUrl = broadcastRecord.audioUrl ?? getLivekitUrl();

  if (!resolvedRoomId && provider === 'livekit' && getLivekitUrl()) {
    const roomName = `broadcast-${broadcastRecord.id}`;
    await ensureLivekitRoom(roomName);
    resolvedRoomId = roomName;

    await db
      .update(broadcasts)
      .set({
        streamRoomId: roomName,
        audioUrl: resolvedAudioUrl,
        updatedAt: new Date(),
      })
      .where(eq(broadcasts.id, broadcastRecord.id));
  }

  if (!resolvedRoomId) {
    throw new ApiError(500, 'configuration_error', 'LiveKit room not configured');
  }

  const token = await createLivekitToken({
    identity: actorId,
    roomName: resolvedRoomId,
    canPublish: false,
  });

  if (!token) {
    const configStatus = getLivekitConfigStatus();
    throw new ApiError(500, 'configuration_error', 'LiveKit credentials missing', configStatus);
  }

  return reply.status(200).send(
    new ApiResponse(200, 'Listener token issued', {
      token,
      roomName: resolvedRoomId,
      livekitUrl: resolvedAudioUrl,
    })
  );
});

// End a broadcast.
const endBroadcast = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const params = request.params;
  if (!params?.id) throw new ApiError(400, 'validation_error', 'Missing broadcast id');
  const { id } = params;

  const body = request.body ?? {};
  const { recordingUrl, endedReason } = body;

  const [broadcastRecord] = await db
    .select({ id: broadcasts.id, masjidId: broadcasts.masjidId, status: broadcasts.status })
    .from(broadcasts)
    .where(eq(broadcasts.id, id))
    .limit(1);

  if (!broadcastRecord) throw new ApiError(404, 'not_found', 'Broadcast not found');
  if (broadcastRecord.status === 'completed') {
    throw new ApiError(409, 'conflict', 'Broadcast already ended');
  }

  await requireMasjidAuthority(actorId, broadcastRecord.masjidId);

  const [updatedBroadcast] = await db
    .update(broadcasts)
    .set({
      status: 'completed',
      endedAt: new Date(),
      recordingUrl: recordingUrl ?? undefined,
      endedReason: endedReason ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(broadcasts.id, id))
    .returning({
      id: broadcasts.id,
      masjidId: broadcasts.masjidId,
      status: broadcasts.status,
      endedAt: broadcasts.endedAt,
      recordingUrl: broadcasts.recordingUrl,
      endedReason: broadcasts.endedReason,
      updatedAt: broadcasts.updatedAt,
    });

  await notificationQueue.add('broadcast-end', {
    broadcastId: updatedBroadcast.id,
    masjidId: updatedBroadcast.masjidId,
  });

  if (isHlsEnabled()) {
    await broadcastQueue.add('hls-stop', { broadcastId: updatedBroadcast.id });
  }

  return reply.status(200).send(new ApiResponse(200, 'Broadcast ended', updatedBroadcast));
});

const getHlsAsset = asyncHandler(async (request, reply) => {
  const params = request.params;
  const query = request.query ?? {};
  if (!params?.id || !params?.file) throw new ApiError(400, 'validation_error', 'Missing HLS asset params');

  const { id, file } = params;
  const { exp, sig } = query;

  let authorized = verifyHlsSignature(id, exp, sig);

  if (!authorized) {
    const authHeader = request.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;
    const cookieToken = request.cookies?.accessToken;
    const token = bearer || cookieToken;

    if (!token) throw new ApiError(401, 'unauthorized', 'Missing token');

    const payload = verifyAccessToken(token);
    const actorId = payload?.id || payload?.sub;
    if (!actorId) throw new ApiError(401, 'unauthorized', 'Invalid token');

    const [broadcastRecord] = await db
      .select({ masjidId: broadcasts.masjidId })
      .from(broadcasts)
      .where(eq(broadcasts.id, id))
      .limit(1);

    if (!broadcastRecord) throw new ApiError(404, 'not_found', 'Broadcast not found');

    const [subscription] = await db
      .select({ userId: subscriptions.userId })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, actorId), eq(subscriptions.masjidId, broadcastRecord.masjidId)))
      .limit(1);

    if (!subscription) throw new ApiError(403, 'forbidden', 'Subscription required');
  }

  const safeFile = path.basename(file);
  const assetPath = path.resolve(env.HLS_OUTPUT_DIR, 'broadcasts', id, safeFile);

  if (!fs.existsSync(assetPath)) {
    throw new ApiError(404, 'not_found', 'HLS asset not found');
  }

  if (safeFile.endsWith('.m3u8')) {
    reply.type('application/vnd.apple.mpegurl');
  } else if (safeFile.endsWith('.m4s')) {
    reply.type('video/iso.segment');
  } else if (safeFile.endsWith('.mp4')) {
    reply.type('video/mp4');
  }

  reply.header('Cache-Control', 'no-cache');
  return reply.send(fs.createReadStream(assetPath));
});

export {
  createBroadcast,
  listBroadcasts,
  startBroadcast,
  endBroadcast,
  getBroadcastToken,
  getBroadcastListenerToken,
  getHlsAsset,
};
