import { and, eq, gte, lt, ne, or } from 'drizzle-orm';
import { db } from './db/client.js';
import { broadcasts, masjids, schedules, scheduleTemplates } from './db/schema.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { DateTime } from 'luxon';

const prepMinutes = Number.isFinite(env.BROADCAST_PREP_MINUTES)
  ? env.BROADCAST_PREP_MINUTES
  : 2;
const intervalSeconds = Number.isFinite(env.SCHEDULER_INTERVAL_SECONDS)
  ? env.SCHEDULER_INTERVAL_SECONDS
  : 60;
const intervalMs = Math.max(10, intervalSeconds) * 1000;

function getDayRange(date) {
  const startOfDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0)
  );
  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);
  return { startOfDay, endOfDay };
}

async function runSchedulerCycle() {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + Math.max(1, prepMinutes) * 60 * 1000);

  await ensureDailySchedulesFromTemplates().catch((error) =>
    logger.error({ err: error }, 'Template schedule generation failed')
  );

  const upcoming = await db
    .select({
      scheduleId: schedules.id,
      masjidId: schedules.masjidId,
      prayerName: schedules.prayerName,
      adhanAtUtc: schedules.adhanAtUtc,
    })
    .from(schedules)
    .innerJoin(masjids, eq(masjids.id, schedules.masjidId))
    .where(
      and(
        eq(masjids.isApproved, true),
        eq(masjids.isActive, true),
        gte(schedules.adhanAtUtc, now),
        lt(schedules.adhanAtUtc, windowEnd)
      )
    );

  let createdCount = 0;

  for (const item of upcoming) {
    const scheduledAt = new Date(item.adhanAtUtc);
    const { startOfDay, endOfDay } = getDayRange(scheduledAt);

    const [existingBroadcast] = await db
      .select({ id: broadcasts.id })
      .from(broadcasts)
      .where(
        and(
          eq(broadcasts.masjidId, item.masjidId),
          eq(broadcasts.prayerName, item.prayerName),
          ne(broadcasts.status, 'failed'),
          or(
            and(gte(broadcasts.scheduledAt, startOfDay), lt(broadcasts.scheduledAt, endOfDay)),
            and(gte(broadcasts.startedAt, startOfDay), lt(broadcasts.startedAt, endOfDay))
          )
        )
      )
      .limit(1);

    if (existingBroadcast) continue;

    await db.insert(broadcasts).values({
      masjidId: item.masjidId,
      title: `${item.prayerName} Adhan`,
      prayerName: item.prayerName,
      status: 'scheduled',
      scheduledAt,
      streamProvider: 'livekit',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    createdCount += 1;
  }

  if (createdCount) {
    logger.info({ created: createdCount }, 'Broadcasts scheduled');
  }
}

async function ensureDailySchedulesFromTemplates() {
  const templates = await db
    .select({
      masjidId: scheduleTemplates.masjidId,
      prayerName: scheduleTemplates.prayerName,
      adhanTimeLocal: scheduleTemplates.adhanTimeLocal,
      iqamahTimeLocal: scheduleTemplates.iqamahTimeLocal,
      khutbahTimeLocal: scheduleTemplates.khutbahTimeLocal,
      isJuma: scheduleTemplates.isJuma,
      timezone: masjids.timezone,
    })
    .from(scheduleTemplates)
    .innerJoin(masjids, eq(masjids.id, scheduleTemplates.masjidId));

  if (!templates.length) return;

  let createdCount = 0;

  for (const template of templates) {
    const timezone = template.timezone || 'Asia/Kolkata';
    const baseDate = DateTime.now().setZone(timezone).startOf('day');

    for (let offset = 0; offset < 2; offset += 1) {
      const day = baseDate.plus({ days: offset });
      const dateString = day.toISODate();

      const [existingSchedule] = await db
        .select({ id: schedules.id })
        .from(schedules)
        .where(and(
          eq(schedules.masjidId, template.masjidId),
          eq(schedules.date, dateString),
          eq(schedules.prayerName, template.prayerName),
        ))
        .limit(1);

      if (existingSchedule) continue;

      const adhanLocal = DateTime.fromISO(`${dateString}T${template.adhanTimeLocal}`, { zone: timezone });
      if (!adhanLocal.isValid) continue;
      const adhanAtUtc = adhanLocal.toUTC().toJSDate();

      const iqamahAtUtc = template.iqamahTimeLocal
        ? DateTime.fromISO(`${dateString}T${template.iqamahTimeLocal}`, { zone: timezone }).toUTC().toJSDate()
        : null;

      const khutbahAtUtc = template.khutbahTimeLocal
        ? DateTime.fromISO(`${dateString}T${template.khutbahTimeLocal}`, { zone: timezone }).toUTC().toJSDate()
        : null;

      await db.insert(schedules).values({
        masjidId: template.masjidId,
        date: dateString,
        prayerName: template.prayerName,
        time: template.adhanTimeLocal,
        adhanAtUtc,
        iqamahAtUtc,
        khutbahAtUtc,
        isJuma: template.isJuma ?? template.prayerName === 'Juma',
      });

      createdCount += 1;
    }
  }

  if (createdCount) {
    logger.info({ created: createdCount }, 'Daily schedules generated from templates');
  }
}

async function startScheduler() {
  logger.info(
    { prepMinutes, intervalSeconds },
    'Broadcast scheduler started'
  );

  await runSchedulerCycle().catch((error) =>
    logger.error({ err: error }, 'Scheduler cycle failed')
  );

  setInterval(() => {
    runSchedulerCycle().catch((error) =>
      logger.error({ err: error }, 'Scheduler cycle failed')
    );
  }, intervalMs);
}

startScheduler();
