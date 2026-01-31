import { AccessToken, EgressClient, RoomServiceClient } from 'livekit-server-sdk';
import { AudioCodec, StreamProtocol } from '@livekit/protocol';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const hasLivekitConfig = Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);

export function getLivekitConfigStatus() {
  const missing = [];
  if (!env.LIVEKIT_URL) missing.push('LIVEKIT_URL');
  if (!env.LIVEKIT_API_KEY) missing.push('LIVEKIT_API_KEY');
  if (!env.LIVEKIT_API_SECRET) missing.push('LIVEKIT_API_SECRET');
  return { ok: missing.length === 0, missing };
}

function getRoomClient() {
  if (!hasLivekitConfig) return null;
  return new RoomServiceClient(env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
}

export async function ensureLivekitRoom(roomName) {
  const client = getRoomClient();
  if (!client) return null;

  try {
    return await client.createRoom({ name: roomName });
  } catch (error) {
    const message = error?.message || '';
    if (message.toLowerCase().includes('already exists')) {
      return null;
    }
    logger.error({ err: error, roomName }, 'LiveKit room creation failed');
    throw error;
  }
}

export async function deleteLivekitRoom(roomName) {
  const client = getRoomClient();
  if (!client || !roomName) return null;

  try {
    return await client.deleteRoom(roomName);
  } catch (error) {
    logger.warn({ err: error, roomName }, 'LiveKit room delete failed');
    return null;
  }
}

export async function createLivekitToken({ identity, roomName, canPublish = false }) {
  if (!hasLivekitConfig) return null;

  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity,
  });

  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
  });

  const jwt = token.toJwt();
  if (typeof jwt?.then === 'function') {
    return await jwt;
  }
  return jwt;
}

export function getLivekitUrl() {
  return env.LIVEKIT_URL ?? null;
}

function getEgressClient() {
  if (!hasLivekitConfig) return null;
  return new EgressClient(env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
}

export async function startLivekitRtmpEgress({ roomName, rtmpUrl, audioBitrateKbps }) {
  const client = getEgressClient();
  if (!client) return null;

  const output = {
    protocol: StreamProtocol.RTMP,
    urls: [rtmpUrl],
  };

  const encodingOptions = {
    audioCodec: AudioCodec.OPUS,
    audioBitrate: audioBitrateKbps,
  };

  return client.startRoomCompositeEgress(roomName, output, {
    audioOnly: true,
    encodingOptions,
  });
}

export async function stopLivekitEgress(egressId) {
  const client = getEgressClient();
  if (!client || !egressId) return null;
  return client.stopEgress(egressId);
}
