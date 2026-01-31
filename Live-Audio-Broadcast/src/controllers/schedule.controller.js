// Schedule controller handlers.
import { and, eq, gte, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '../db/client.js';
import { masjidAdmins, masjids, schedules, scheduleTemplates } from '../db/schema.js';
import { redis } from '../config/redis.js';
import { asyncHandler } from '../utils/async-handler.js';
import { ApiError } from '../utils/api-error.js';
import { ApiResponse } from '../utils/api-response.js';

const SCHEDULE_CACHE_TTL_SECONDS = 3600;

// Check if the user is allowed to manage schedules for a masjid.
async function requireMasjidAuthority(actorId, masjidId) {
  const [adminRecord] = await db
    .select({ role: masjidAdmins.role })
    .from(masjidAdmins)
    .where(and(eq(masjidAdmins.userId, actorId), eq(masjidAdmins.masjidId, masjidId)))
    .limit(1);

  if (!adminRecord) {
    throw new ApiError(403, 'forbidden', 'Insufficient privileges');
  }

  return adminRecord;
}

async function getMasjidTimezone(masjidId) {
  const [masjid] = await db
    .select({ timezone: masjids.timezone })
    .from(masjids)
    .where(eq(masjids.id, masjidId))
    .limit(1);

  return masjid?.timezone || 'Asia/Kolkata';
}

function parseLocalDateTime({ date, time, timezone }) {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: timezone });
  if (!dt.isValid) {
    throw new ApiError(400, 'validation_error', 'Invalid local time or timezone');
  }
  return dt;
}

function toUtcDate({ date, time, timezone }) {
  return parseLocalDateTime({ date, time, timezone }).toUTC().toJSDate();
}

function formatLocalTime({ dateTime, timezone }) {
  return DateTime.fromJSDate(dateTime, { zone: timezone }).toFormat('HH:mm:ss');
}

function normalizeTimeString(value) {
  if (!value) return null;
  const candidate = value.length === 5 ? `${value}:00` : value;
  const dt = DateTime.fromFormat(candidate, 'HH:mm:ss');
  if (!dt.isValid) {
    throw new ApiError(400, 'validation_error', 'Invalid time format (HH:mm or HH:mm:ss)');
  }
  return candidate;
}

// Ensure Jumu'ah is on Friday when provided.
function assertJumaDate(dateString, prayerName) {
  if (prayerName !== 'Juma') return;
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, 'validation_error', 'Invalid date');
  }
  if (date.getUTCDay() !== 5) {
    throw new ApiError(400, 'validation_error', 'Juma must be on Friday');
  }
}

// Cache schedules for a day.
async function cacheSchedules(masjidId, date, data) {
  const payload = JSON.stringify(data);
  await redis.setex(`schedules:${masjidId}:${date}`, SCHEDULE_CACHE_TTL_SECONDS, payload);
}

// Clear schedule cache for a day.
async function clearSchedulesCache(masjidId, date) {
  await redis.del(`schedules:${masjidId}:${date}`);
}

// Create or update a schedule entry.
const createSchedule = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const params = request.params;
  if (!params?.id) throw new ApiError(400, 'validation_error', 'Missing masjid id');
  const { id: masjidId } = params;

  const body = request.body;
  if (!body) throw new ApiError(400, 'validation_error', 'Missing request body');

  await requireMasjidAuthority(actorId, masjidId);

  const {
    date,
    prayerName,
    adhanAtUtc,
    adhanTimeLocal,
    timezone: timezoneOverride,
    iqamahAtUtc,
    iqamahTimeLocal,
    khutbahAtUtc,
    khutbahTimeLocal,
    isJuma,
  } = body;

  assertJumaDate(date, prayerName);

  const [existingSchedule] = await db
    .select({ id: schedules.id })
    .from(schedules)
    .where(and(eq(schedules.masjidId, masjidId), eq(schedules.date, date), eq(schedules.prayerName, prayerName)))
    .limit(1);

  const timezone = timezoneOverride ?? await getMasjidTimezone(masjidId);
  const resolvedAdhanAtUtc = adhanAtUtc
    ? new Date(adhanAtUtc)
    : toUtcDate({ date, time: adhanTimeLocal, timezone });
  const resolvedIqaamahAtUtc = iqamahAtUtc
    ? new Date(iqamahAtUtc)
    : iqamahTimeLocal
      ? toUtcDate({ date, time: iqamahTimeLocal, timezone })
      : null;
  const resolvedKhutbahAtUtc = khutbahAtUtc
    ? new Date(khutbahAtUtc)
    : khutbahTimeLocal
      ? toUtcDate({ date, time: khutbahTimeLocal, timezone })
      : null;
  const localTime = adhanTimeLocal ?? formatLocalTime({ dateTime: resolvedAdhanAtUtc, timezone });

  if (existingSchedule) {
    const [updatedSchedule] = await db
      .update(schedules)
      .set({
        time: localTime,
        adhanAtUtc: resolvedAdhanAtUtc,
        iqamahAtUtc: resolvedIqaamahAtUtc,
        khutbahAtUtc: resolvedKhutbahAtUtc,
        isJuma: isJuma ?? prayerName === 'Juma',
        updatedAt: new Date(),
      })
      .where(eq(schedules.id, existingSchedule.id))
      .returning({
        id: schedules.id,
        masjidId: schedules.masjidId,
        date: schedules.date,
        prayerName: schedules.prayerName,
        adhanAtUtc: schedules.adhanAtUtc,
        iqamahAtUtc: schedules.iqamahAtUtc,
        khutbahAtUtc: schedules.khutbahAtUtc,
        isJuma: schedules.isJuma,
        createdAt: schedules.createdAt,
        updatedAt: schedules.updatedAt,
      });

    await clearSchedulesCache(masjidId, date);
    return reply.status(200).send(new ApiResponse(200, 'Schedule updated', updatedSchedule));
  }

  const [createdSchedule] = await db
    .insert(schedules)
    .values({
      masjidId,
      date,
      prayerName,
      time: localTime,
      adhanAtUtc: resolvedAdhanAtUtc,
      iqamahAtUtc: resolvedIqaamahAtUtc,
      khutbahAtUtc: resolvedKhutbahAtUtc,
      isJuma: isJuma ?? prayerName === 'Juma',
    })
    .returning({
      id: schedules.id,
      masjidId: schedules.masjidId,
      date: schedules.date,
      prayerName: schedules.prayerName,
      adhanAtUtc: schedules.adhanAtUtc,
      iqamahAtUtc: schedules.iqamahAtUtc,
      khutbahAtUtc: schedules.khutbahAtUtc,
      isJuma: schedules.isJuma,
      createdAt: schedules.createdAt,
      updatedAt: schedules.updatedAt,
    });

  await clearSchedulesCache(masjidId, date);
  return reply.status(201).send(new ApiResponse(201, 'Schedule created', createdSchedule));
});

// Create or update recurring schedule template.
const upsertScheduleTemplate = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const params = request.params;
  if (!params?.id) throw new ApiError(400, 'validation_error', 'Missing masjid id');
  const { id: masjidId } = params;

  const body = request.body;
  if (!body) throw new ApiError(400, 'validation_error', 'Missing request body');

  await requireMasjidAuthority(actorId, masjidId);

  const {
    prayerName,
    adhanTimeLocal,
    iqamahTimeLocal,
    khutbahTimeLocal,
    timezone: timezoneOverride,
    isJuma,
  } = body;

  assertJumaDate(DateTime.now().toISODate(), prayerName);

  const timezone = timezoneOverride ?? await getMasjidTimezone(masjidId);
  const normalizedAdhan = normalizeTimeString(adhanTimeLocal);
  const normalizedIqaamah = normalizeTimeString(iqamahTimeLocal);
  const normalizedKhutbah = normalizeTimeString(khutbahTimeLocal);

  const [existingTemplate] = await db
    .select({ masjidId: scheduleTemplates.masjidId, prayerName: scheduleTemplates.prayerName })
    .from(scheduleTemplates)
    .where(and(eq(scheduleTemplates.masjidId, masjidId), eq(scheduleTemplates.prayerName, prayerName)))
    .limit(1);

  let savedTemplate;

  if (existingTemplate) {
    [savedTemplate] = await db
      .update(scheduleTemplates)
      .set({
        adhanTimeLocal: normalizedAdhan,
        iqamahTimeLocal: normalizedIqaamah,
        khutbahTimeLocal: normalizedKhutbah,
        isJuma: isJuma ?? prayerName === 'Juma',
        updatedAt: new Date(),
      })
      .where(and(eq(scheduleTemplates.masjidId, masjidId), eq(scheduleTemplates.prayerName, prayerName)))
      .returning({
        masjidId: scheduleTemplates.masjidId,
        prayerName: scheduleTemplates.prayerName,
        adhanTimeLocal: scheduleTemplates.adhanTimeLocal,
        iqamahTimeLocal: scheduleTemplates.iqamahTimeLocal,
        khutbahTimeLocal: scheduleTemplates.khutbahTimeLocal,
        isJuma: scheduleTemplates.isJuma,
        updatedAt: scheduleTemplates.updatedAt,
      });
  } else {
    [savedTemplate] = await db
      .insert(scheduleTemplates)
      .values({
        masjidId,
        prayerName,
        adhanTimeLocal: normalizedAdhan,
        iqamahTimeLocal: normalizedIqaamah,
        khutbahTimeLocal: normalizedKhutbah,
        isJuma: isJuma ?? prayerName === 'Juma',
      })
      .returning({
        masjidId: scheduleTemplates.masjidId,
        prayerName: scheduleTemplates.prayerName,
        adhanTimeLocal: scheduleTemplates.adhanTimeLocal,
        iqamahTimeLocal: scheduleTemplates.iqamahTimeLocal,
        khutbahTimeLocal: scheduleTemplates.khutbahTimeLocal,
        isJuma: scheduleTemplates.isJuma,
        createdAt: scheduleTemplates.createdAt,
      });
  }

  return reply.status(200).send(new ApiResponse(200, 'Schedule template saved', {
    ...savedTemplate,
    timezone,
  }));
});

// Bulk upsert schedules for a day.
const upsertSchedules = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const params = request.params;
  if (!params?.id) throw new ApiError(400, 'validation_error', 'Missing masjid id');
  const { id: masjidId } = params;

  const body = request.body;
  if (!body) throw new ApiError(400, 'validation_error', 'Missing request body');

  await requireMasjidAuthority(actorId, masjidId);

  const { schedules: scheduleItems } = body;
  const results = [];

  for (const item of scheduleItems) {
    assertJumaDate(item.date, item.prayerName);
    const [existingSchedule] = await db
      .select({ id: schedules.id })
      .from(schedules)
      .where(and(eq(schedules.masjidId, masjidId), eq(schedules.date, item.date), eq(schedules.prayerName, item.prayerName)))
      .limit(1);

    if (existingSchedule) {
      const [updatedSchedule] = await db
        .update(schedules)
        .set({
          adhanAtUtc: new Date(item.adhanAtUtc),
          iqamahAtUtc: item.iqamahAtUtc ? new Date(item.iqamahAtUtc) : null,
          khutbahAtUtc: item.khutbahAtUtc ? new Date(item.khutbahAtUtc) : null,
          isJuma: item.isJuma ?? item.prayerName === 'Juma',
          updatedAt: new Date(),
        })
        .where(eq(schedules.id, existingSchedule.id))
        .returning({
          id: schedules.id,
          masjidId: schedules.masjidId,
          date: schedules.date,
          prayerName: schedules.prayerName,
          adhanAtUtc: schedules.adhanAtUtc,
          iqamahAtUtc: schedules.iqamahAtUtc,
          khutbahAtUtc: schedules.khutbahAtUtc,
          isJuma: schedules.isJuma,
          createdAt: schedules.createdAt,
          updatedAt: schedules.updatedAt,
        });
      results.push(updatedSchedule);
      await clearSchedulesCache(masjidId, item.date);
      continue;
    }

    const [createdSchedule] = await db
      .insert(schedules)
      .values({
        masjidId,
        date: item.date,
        prayerName: item.prayerName,
        time: new Date(item.adhanAtUtc).toISOString().slice(11, 19),
        adhanAtUtc: new Date(item.adhanAtUtc),
        iqamahAtUtc: item.iqamahAtUtc ? new Date(item.iqamahAtUtc) : null,
        khutbahAtUtc: item.khutbahAtUtc ? new Date(item.khutbahAtUtc) : null,
        isJuma: item.isJuma ?? item.prayerName === 'Juma',
      })
      .returning({
        id: schedules.id,
        masjidId: schedules.masjidId,
        date: schedules.date,
        prayerName: schedules.prayerName,
        adhanAtUtc: schedules.adhanAtUtc,
        iqamahAtUtc: schedules.iqamahAtUtc,
        khutbahAtUtc: schedules.khutbahAtUtc,
        isJuma: schedules.isJuma,
        createdAt: schedules.createdAt,
        updatedAt: schedules.updatedAt,
      });
    results.push(createdSchedule);
    await clearSchedulesCache(masjidId, item.date);
  }

  return reply.status(200).send(new ApiResponse(200, 'Schedules upserted', results));
});

// Update a schedule by id.
const updateSchedule = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const params = request.params;
  if (!params?.id || !params?.scheduleId) throw new ApiError(400, 'validation_error', 'Missing schedule id');
  const { id: masjidId, scheduleId } = params;

  const body = request.body;
  if (!body) throw new ApiError(400, 'validation_error', 'Missing request body');

  await requireMasjidAuthority(actorId, masjidId);

  const [existingSchedule] = await db
    .select({ id: schedules.id, date: schedules.date, prayerName: schedules.prayerName })
    .from(schedules)
    .where(and(eq(schedules.id, scheduleId), eq(schedules.masjidId, masjidId)))
    .limit(1);

  if (!existingSchedule) throw new ApiError(404, 'not_found', 'Schedule not found');

  const {
    adhanAtUtc,
    adhanTimeLocal,
    timezone: timezoneOverride,
    iqamahAtUtc,
    iqamahTimeLocal,
    khutbahAtUtc,
    khutbahTimeLocal,
    isJuma,
  } = body;
  assertJumaDate(existingSchedule.date, existingSchedule.prayerName);

  const timezone = timezoneOverride ?? await getMasjidTimezone(masjidId);
  const resolvedAdhanAtUtc = adhanAtUtc
    ? new Date(adhanAtUtc)
    : adhanTimeLocal
      ? toUtcDate({ date: existingSchedule.date, time: adhanTimeLocal, timezone })
      : undefined;
  const resolvedIqaamahAtUtc = iqamahAtUtc
    ? new Date(iqamahAtUtc)
    : iqamahTimeLocal
      ? toUtcDate({ date: existingSchedule.date, time: iqamahTimeLocal, timezone })
      : iqamahAtUtc === null || iqamahTimeLocal === null
        ? null
        : undefined;
  const resolvedKhutbahAtUtc = khutbahAtUtc
    ? new Date(khutbahAtUtc)
    : khutbahTimeLocal
      ? toUtcDate({ date: existingSchedule.date, time: khutbahTimeLocal, timezone })
      : khutbahAtUtc === null || khutbahTimeLocal === null
        ? null
        : undefined;
  const localTime = resolvedAdhanAtUtc
    ? formatLocalTime({ dateTime: resolvedAdhanAtUtc, timezone })
    : undefined;

  const [updatedSchedule] = await db
    .update(schedules)
    .set({
      time: localTime ?? undefined,
      adhanAtUtc: resolvedAdhanAtUtc ?? undefined,
      iqamahAtUtc: resolvedIqaamahAtUtc,
      khutbahAtUtc: resolvedKhutbahAtUtc,
      isJuma: isJuma ?? existingSchedule.prayerName === 'Juma',
      updatedAt: new Date(),
    })
    .where(eq(schedules.id, scheduleId))
    .returning({
      id: schedules.id,
      masjidId: schedules.masjidId,
      date: schedules.date,
      prayerName: schedules.prayerName,
      adhanAtUtc: schedules.adhanAtUtc,
      iqamahAtUtc: schedules.iqamahAtUtc,
      khutbahAtUtc: schedules.khutbahAtUtc,
      isJuma: schedules.isJuma,
      createdAt: schedules.createdAt,
      updatedAt: schedules.updatedAt,
    });

  await clearSchedulesCache(masjidId, existingSchedule.date);
  return reply.status(200).send(new ApiResponse(200, 'Schedule updated', updatedSchedule));
});

// List schedules for a masjid with cache support.
const listSchedules = asyncHandler(async (request, reply) => {
  const params = request.params;
  if (!params?.id) throw new ApiError(400, 'validation_error', 'Missing masjid id');
  const { id: masjidId } = params;

  const query = request.query ?? {};
  const { date, startDate, endDate } = query;

  if (date) {
    const cached = await redis.get(`schedules:${masjidId}:${date}`);
    if (cached) {
      return reply.status(200).send(new ApiResponse(200, 'Schedules fetched', JSON.parse(cached)));
    }
  }

  const filters = [eq(schedules.masjidId, masjidId)];
  if (date) {
    filters.push(eq(schedules.date, date));
  }
  if (startDate) {
    filters.push(gte(schedules.date, startDate));
  }
  if (endDate) {
    filters.push(lte(schedules.date, endDate));
  }

  const whereClause = filters.length ? and(...filters) : undefined;
  const scheduleList = await db
    .select({
      id: schedules.id,
      masjidId: schedules.masjidId,
      date: schedules.date,
      prayerName: schedules.prayerName,
      adhanAtUtc: schedules.adhanAtUtc,
      iqamahAtUtc: schedules.iqamahAtUtc,
      khutbahAtUtc: schedules.khutbahAtUtc,
      isJuma: schedules.isJuma,
      createdAt: schedules.createdAt,
      updatedAt: schedules.updatedAt,
    })
    .from(schedules)
    .where(whereClause)
    .orderBy(schedules.adhanAtUtc);

  if (date) {
    await cacheSchedules(masjidId, date, scheduleList);
  }

  return reply.status(200).send(new ApiResponse(200, 'Schedules fetched', scheduleList));
});

export {
  createSchedule,
  upsertScheduleTemplate,
  upsertSchedules,
  updateSchedule,
  listSchedules,
};
