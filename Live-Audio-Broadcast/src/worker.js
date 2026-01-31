import { and, eq } from 'drizzle-orm';
import { broadcastQueue, createWorker, notificationQueue } from './queues/queue.factory.js';
import { db } from './db/client.js';
import { broadcasts, notificationLogs, subscriptions, userDevices } from './db/schema.js';
import { logger } from './config/logger.js';
import { sendFcmData, sendVoipPush } from './services/push.js';
import { createLivekitToken, deleteLivekitRoom, getLivekitUrl } from './services/livekit.js';
import { getHlsPublicUrl, isHlsEnabled, startHlsRelay, stopHlsRelay } from './services/hls.js';
import { env } from './config/env.js';

// Notification worker to honor subscription preferences.
createWorker('notifications', async (job) => {
  const { broadcastId, masjidId, prayerName } = job.data || {};
  if (!broadcastId || !masjidId) return;

  const eventType = job.name === 'broadcast-end' ? 'end' : 'start';

  const [broadcastRecord] = await db
    .select({
      id: broadcasts.id,
      streamProvider: broadcasts.streamProvider,
      streamRoomId: broadcasts.streamRoomId,
      audioUrl: broadcasts.audioUrl,
      hlsUrl: broadcasts.hlsUrl,
    })
    .from(broadcasts)
    .where(eq(broadcasts.id, broadcastId))
    .limit(1);

  if (!broadcastRecord) return;

  const results = await db
    .select({
      userId: subscriptions.userId,
      preferences: subscriptions.preferences,
      isMuted: subscriptions.isMuted,
      muteUntil: subscriptions.muteUntil,
      deviceId: userDevices.id,
      fcmToken: userDevices.fcmToken,
      voipToken: userDevices.voipToken,
      platform: userDevices.platform,
      wakeOnSilentEnabled: userDevices.isWakeOnSilentEnabled,
      deviceActive: userDevices.isActive,
    })
    .from(subscriptions)
    .innerJoin(userDevices, eq(userDevices.userId, subscriptions.userId))
    .where(and(eq(subscriptions.masjidId, masjidId), eq(userDevices.isActive, true)));

  const now = Date.now();
  const logs = [];

  for (const record of results) {
    if (record.isMuted) continue;
    if (record.muteUntil && record.muteUntil.getTime() > now) continue;

    const prefs = record.preferences || {};
    const mutedPrayers = Array.isArray(prefs.mutedPrayers) ? prefs.mutedPrayers : [];
    if (prayerName && mutedPrayers.includes(prayerName)) continue;

    const roomName = broadcastRecord.streamRoomId ?? null;
    const livekitUrl = broadcastRecord.audioUrl ?? getLivekitUrl();
    const hlsUrl = broadcastRecord.hlsUrl ?? (isHlsEnabled() ? getHlsPublicUrl(broadcastId) : null);
    const token =
      eventType === 'start' && roomName && !hlsUrl
        ? await createLivekitToken({ identity: record.userId, roomName, canPublish: false })
        : null;

    const payload = {
      action: eventType === 'start' ? 'GO_LIVE' : 'END',
      broadcastId,
      masjidId,
      prayerName: prayerName ?? '',
      roomName: roomName ?? '',
      livekitUrl: livekitUrl ?? '',
      token: token ?? '',
      streamUrl: hlsUrl ?? '',
    };

    let result = { status: 'failed', provider: null, error: 'unsupported_platform' };

    if (record.platform === 'ios') {
      result = await sendVoipPush({ token: record.voipToken, data: payload });
    } else {
      result = await sendFcmData({ token: record.fcmToken, data: payload });
    }

    const { status, provider, error } = result;

    logs.push({
      userId: record.userId,
      deviceId: record.deviceId,
      masjidId,
      broadcastId,
      status,
      provider,
      error,
    });
  }

  if (logs.length) {
    await db.insert(notificationLogs).values(logs);
  }

  logger.info({ broadcastId, masjidId, queued: logs.length }, 'Notifications queued');
});

// Auto-end live broadcasts after max duration.
createWorker('broadcasts', async (job) => {
  if (job.name === 'hls-start') {
    const { broadcastId, roomName } = job.data || {};
    if (!broadcastId || !roomName) return;

    try {
      const relayInfo = await startHlsRelay({ broadcastId, roomName });
      if (relayInfo?.hlsUrl) {
        await db
          .update(broadcasts)
          .set({
            hlsUrl: relayInfo.hlsUrl,
            hlsEgressId: relayInfo.egressId ?? null,
            hlsRtmpUrl: relayInfo.rtmpUrl ?? null,
            updatedAt: new Date(),
          })
          .where(eq(broadcasts.id, broadcastId));
      }
    } catch (error) {
      logger.error({ err: error, broadcastId }, 'Failed to start HLS relay');
    }
    return;
  }

  if (job.name === 'hls-stop') {
    const { broadcastId } = job.data || {};
    if (!broadcastId) return;
    await stopHlsRelay(broadcastId);
    await db
      .update(broadcasts)
      .set({ hlsEgressId: null, updatedAt: new Date() })
      .where(eq(broadcasts.id, broadcastId));
    return;
  }

  const { broadcastId, endedReason } = job.data || {};
  if (!broadcastId) return;

  const [broadcastRecord] = await db
    .select({ id: broadcasts.id, status: broadcasts.status, streamRoomId: broadcasts.streamRoomId })
    .from(broadcasts)
    .where(eq(broadcasts.id, broadcastId))
    .limit(1);

  if (!broadcastRecord || broadcastRecord.status !== 'live') return;

  const maxMinutes = Number.isFinite(env.BROADCAST_MAX_MINUTES) && env.BROADCAST_MAX_MINUTES > 0
    ? env.BROADCAST_MAX_MINUTES
    : 15;

  if (broadcastRecord.startedAt) {
    const elapsedMs = Date.now() - broadcastRecord.startedAt.getTime();
    const targetMs = maxMinutes * 60 * 1000;

    if (elapsedMs < targetMs - 1000) {
      const remainingMs = Math.max(1000, targetMs - elapsedMs);
      await broadcastQueue.add(
        'broadcast-auto-end',
        { broadcastId, endedReason: endedReason ?? 'max_duration_reached' },
        { delay: remainingMs, jobId: `broadcast-auto-end-${broadcastId}-${Date.now()}` }
      );
      logger.warn({ broadcastId, elapsedMs, remainingMs }, 'Auto-end job ran early; rescheduled');
      return;
    }
  }

  const [updatedBroadcast] = await db
    .update(broadcasts)
    .set({
      status: 'completed',
      endedAt: new Date(),
      endedReason: endedReason ?? 'max_duration_reached',
      updatedAt: new Date(),
    })
    .where(eq(broadcasts.id, broadcastId))
    .returning({
      id: broadcasts.id,
      masjidId: broadcasts.masjidId,
    });

  if (updatedBroadcast) {
    await notificationQueue.add('broadcast-end', {
      broadcastId: updatedBroadcast.id,
      masjidId: updatedBroadcast.masjidId,
    });
  }

  await stopHlsRelay(broadcastId);
  await deleteLivekitRoom(broadcastRecord.streamRoomId);

  logger.info({ broadcastId }, 'Broadcast auto-ended');
});

async function cleanupExpiredBroadcasts() {
  const maxMinutes = Number.isFinite(env.BROADCAST_MAX_MINUTES)
    ? env.BROADCAST_MAX_MINUTES
    : 15;
  const cutoff = new Date(Date.now() - Math.max(1, maxMinutes) * 60 * 1000);

  const expired = await db
    .select({
      id: broadcasts.id,
      masjidId: broadcasts.masjidId,
      streamRoomId: broadcasts.streamRoomId,
    })
    .from(broadcasts)
    .where(and(eq(broadcasts.status, 'live'), lt(broadcasts.startedAt, cutoff)));

  if (!expired.length) return;

  for (const item of expired) {
    await db
      .update(broadcasts)
      .set({
        status: 'completed',
        endedAt: new Date(),
        endedReason: 'max_duration_reached',
        updatedAt: new Date(),
      })
      .where(eq(broadcasts.id, item.id));

    await notificationQueue.add('broadcast-end', {
      broadcastId: item.id,
      masjidId: item.masjidId,
    });

    await stopHlsRelay(item.id);
    await deleteLivekitRoom(item.streamRoomId);
  }

  logger.info({ count: expired.length }, 'Expired broadcasts cleaned');
}

cleanupExpiredBroadcasts().catch((error) =>
  logger.error({ err: error }, 'Expired broadcast cleanup failed')
);

setInterval(() => {
  cleanupExpiredBroadcasts().catch((error) =>
    logger.error({ err: error }, 'Expired broadcast cleanup failed')
  );
}, 5 * 60 * 1000).unref();