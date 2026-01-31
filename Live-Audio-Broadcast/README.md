# Live Audio Broadcast Backend

High-performance, self-hosted backend for a Masjid/Azaan live audio broadcast platform with wake-on-silent support. Stack: Fastify (ESM), PostgreSQL (Drizzle ORM), Redis/BullMQ, Zod validation, JWT auth, Pino logging.

## Features
- Fastify API with Zod-validated inputs and centralized error handling
- PostgreSQL via Drizzle ORM and `pg` pooling; schema with sensible indexes
- Redis for caching, BullMQ queues for background jobs and notifications
- JWT access/refresh tokens with secure HTTP-only cookies
- Docker-friendly configuration; stateless runtime

## Getting Started
1. Copy env template: `cp .env.example .env` and set secrets/URLs.
2. Install deps: `npm install`.
3. Run dev server: `npm run dev`.
4. Run lint: `npm run lint`.

## Structure
```
src/
  config/       // env, logger, redis
  db/           // drizzle schema and client
  middleware/   // error handling, auth hooks
  modules/      // feature modules (auth, masjid, schedule, broadcast)
  queues/       // BullMQ setup
  routes/       // route registration
  utils/        // helpers (jwt, hash)
```

## Scripts
- `npm run dev` – start API with watch mode
- `npm start` – production start
- `npm run migrate` – apply SQL migrations in `./drizzle`
- `npm run lint` – lint codebase
- `npm run format` – format with Prettier

## Migrations
Configure credentials in `.env`, then:
- Apply SQL migrations: `npm run migrate`

## Docker Compose (Profiles)
Single compose file with profiles:
- `livekit` – LiveKit server
- `hls` – nginx-rtmp for RTMP ingest + HLS hosting
- `app` – API/worker/scheduler containers
- `infra` – Postgres/Redis (local/dev only)

## LiveKit (Local Docker)
- Compose file: docker-compose.yml (profile: `livekit`)
- Config file: livekit.yaml
- Default ports: 7880 (HTTP), 7881 (TCP), 7882/udp (UDP)
- Dev API credentials: key=devkey, secret=devsecret

Update these credentials before any non-local usage.

### Broadcaster Token (Dev)
- Endpoint: POST /api/v1/broadcasts/:id/token (auth required)
- Dev UI: dev/broadcaster.html (paste token + URL to start mic)

### Listener Token (Dev)
When HLS is enabled (`HLS_ENABLED=true`), this endpoint returns a `streamUrl` instead of a LiveKit token.

## HLS (LL-HLS + RTMP)
- Enable: `HLS_ENABLED=true`
- Set `HLS_RTMP_PUBLISH_URL_TEMPLATE` and `HLS_RTMP_PLAY_URL_TEMPLATE`
- Use `HLS_AUDIO_BITRATE_KBPS=16` (or 24) to toggle bitrate
- On-demand ffmpeg uses Docker if `HLS_FFMPEG_MODE=docker`

## Notes
- Use Node.js 20+.
- Keep services stateless; rely on Redis for shared state and rate limiting.
- Heavy tasks should go through BullMQ workers (see `src/queues`).
