import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { startLivekitRtmpEgress, stopLivekitEgress } from './livekit.js';

const activeRelays = new Map();

function applyTemplate(value, params) {
  return value.replace(/\{(broadcastId|roomName)\}/g, (_, key) => params[key] ?? '');
}

export function isHlsEnabled() {
  return Boolean(env.HLS_ENABLED);
}

export function getHlsPublicUrl(broadcastId) {
  if (!env.HLS_PUBLIC_BASE_URL) return null;
  return `${env.HLS_PUBLIC_BASE_URL}/broadcasts/${broadcastId}/index.m3u8`;
}

export function signHlsUrl(broadcastId, basePath = '/api/v1') {
  if (!env.HLS_SIGNING_SECRET) return null;
  const ttlSeconds = Number(env.HLS_URL_TTL_SECONDS) || 900;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${broadcastId}.${exp}`;
  const sig = crypto
    .createHmac('sha256', env.HLS_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  const pathPrefix = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${pathPrefix}/broadcasts/${broadcastId}/hls/index.m3u8?exp=${exp}&sig=${sig}`;
}

export function verifyHlsSignature(broadcastId, exp, sig) {
  if (!env.HLS_SIGNING_SECRET || !exp || !sig) return false;
  const expNumber = Number(exp);
  if (!Number.isFinite(expNumber)) return false;
  if (expNumber < Math.floor(Date.now() / 1000)) return false;
  const payload = `${broadcastId}.${expNumber}`;
  const expected = crypto
    .createHmac('sha256', env.HLS_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(sig);
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

function getRtmpUrls({ broadcastId, roomName }) {
  if (!env.HLS_RTMP_PUBLISH_URL_TEMPLATE) return { publishUrl: null, playUrl: null };
  const publishUrl = applyTemplate(env.HLS_RTMP_PUBLISH_URL_TEMPLATE, { broadcastId, roomName });
  const playTemplate = env.HLS_RTMP_PLAY_URL_TEMPLATE || env.HLS_RTMP_PUBLISH_URL_TEMPLATE;
  const playUrl = applyTemplate(playTemplate, { broadcastId, roomName });
  return { publishUrl, playUrl };
}

async function ensureOutputDir(broadcastId) {
  const dir = path.resolve(env.HLS_OUTPUT_DIR, 'broadcasts', broadcastId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function buildContainerOutputDir(broadcastId) {
  return path.posix.join('/hls', 'broadcasts', broadcastId);
}

function buildFfmpegArgs({ inputUrl, outputDir }) {
  const bitrate = env.HLS_AUDIO_BITRATE_KBPS;
  const segmentSeconds = Math.max(1, env.HLS_SEGMENT_SECONDS);

  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputUrl,
    '-vn',
    '-c:a',
    'libopus',
    '-b:a',
    `${bitrate}k`,
    '-application',
    'audio',
    '-f',
    'hls',
    '-hls_time',
    `${segmentSeconds}`,
    '-hls_playlist_type',
    'event',
    '-hls_flags',
    'delete_segments+append_list+program_date_time+independent_segments',
    '-hls_segment_type',
    'fmp4',
    '-hls_list_size',
    '6',
    '-hls_fmp4_init_filename',
    'init.mp4',
    '-hls_segment_filename',
    path.join(outputDir, 'segment_%05d.m4s'),
    path.join(outputDir, 'index.m3u8'),
  ];
}

function buildDockerArgs({ name, inputUrl, outputDir, hostOutputDir }) {
  const args = ['run', '--rm', '--name', name];

  if (env.HLS_FFMPEG_DOCKER_NETWORK) {
    args.push('--network', env.HLS_FFMPEG_DOCKER_NETWORK);
  }

  args.push('-v', `${hostOutputDir}:/hls`);
  args.push(env.HLS_FFMPEG_DOCKER_IMAGE, 'ffmpeg');

  return args.concat(buildFfmpegArgs({ inputUrl, outputDir }));
}

export async function startHlsRelay({ broadcastId, roomName }) {
  if (!isHlsEnabled()) return null;

  const { publishUrl, playUrl } = getRtmpUrls({ broadcastId, roomName });
  if (!publishUrl || !playUrl) {
    throw new Error('HLS RTMP URL templates are not configured');
  }

  const outputDir = await ensureOutputDir(broadcastId);

  const egressInfo = await startLivekitRtmpEgress({
    roomName,
    rtmpUrl: publishUrl,
    audioBitrateKbps: env.HLS_AUDIO_BITRATE_KBPS,
  });

  const ffmpegMode = env.HLS_FFMPEG_MODE;
  const containerOutputDir = buildContainerOutputDir(broadcastId);

  const ffmpegArgs =
    ffmpegMode === 'docker'
      ? buildDockerArgs({
          name: `${env.HLS_FFMPEG_CONTAINER_PREFIX}${broadcastId}`,
          inputUrl: playUrl,
          outputDir: containerOutputDir,
          hostOutputDir: env.HLS_OUTPUT_DIR,
        })
      : buildFfmpegArgs({ inputUrl: playUrl, outputDir });

  const ffmpegCommand = ffmpegMode === 'docker' ? 'docker' : 'ffmpeg';
  const ffmpeg = spawn(ffmpegCommand, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  ffmpeg.stdout.on('data', (chunk) => {
    logger.info({ broadcastId, message: chunk.toString() }, 'FFmpeg output');
  });

  ffmpeg.stderr.on('data', (chunk) => {
    logger.warn({ broadcastId, message: chunk.toString() }, 'FFmpeg error');
  });

  ffmpeg.on('exit', (code, signal) => {
    logger.info({ broadcastId, code, signal }, 'FFmpeg exited');
    activeRelays.delete(broadcastId);
  });

  const relay = {
    broadcastId,
    roomName,
    egressId: egressInfo?.egressId ?? null,
    rtmpUrl: publishUrl,
    process: ffmpeg,
  };

  activeRelays.set(broadcastId, relay);

  return {
    hlsUrl: getHlsPublicUrl(broadcastId),
    egressId: relay.egressId,
    rtmpUrl: relay.rtmpUrl,
  };
}

export async function stopHlsRelay(broadcastId) {
  const relay = activeRelays.get(broadcastId);
  if (!relay) return null;

  try {
    if (relay.process?.pid) {
      relay.process.kill('SIGTERM');
    }
  } catch (error) {
    logger.warn({ err: error, broadcastId }, 'Failed to stop ffmpeg process');
  }

  if (relay.egressId) {
    try {
      await stopLivekitEgress(relay.egressId);
    } catch (error) {
      logger.warn({ err: error, broadcastId }, 'Failed to stop LiveKit egress');
    }
  }

  activeRelays.delete(broadcastId);
  return true;
}
