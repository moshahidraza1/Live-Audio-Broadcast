import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// Enums ensure data integrity for known values
export const userRoleEnum = pgEnum('user_role', ['listener', 'masjid_admin', 'super_admin']);
export const masjidAdminRoleEnum = pgEnum('masjid_admin_role', ['manager', 'imam', 'muazzin']);
export const masjidRequestStatusEnum = pgEnum('masjid_request_status', ['pending', 'approved', 'rejected']);
export const broadcastStatusEnum = pgEnum('broadcast_status', ['pending', 'scheduled', 'live', 'completed', 'failed']);
export const prayerNameEnum = pgEnum('prayer_name', ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Juma']);
export const platformEnum = pgEnum('platform', ['android', 'ios', 'web']);
export const notificationStatusEnum = pgEnum('notification_status', ['queued', 'sent', 'failed']);

// 1. USERS: authentication and role management
export const users = pgTable(
  'users',
  {
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: userRoleEnum('role').notNull().default('listener'),
    isVerified: boolean('is_verified').default(false).notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('users_email_uq').on(table.email),
    index('users_role_idx').on(table.role),
  ]
);

// 2. USER DEVICES: critical for Wake-on-Silent delivery
export const userDevices = pgTable(
  'user_devices',
  {
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    deviceId: varchar('device_id', { length: 128 }).notNull(),
    fcmToken: text('fcm_token'),
    voipToken: text('voip_token'),
    platform: platformEnum('platform').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    isWakeOnSilentEnabled: boolean('is_wake_on_silent_enabled').default(true).notNull(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('devices_user_idx').on(table.userId),
    index('devices_platform_idx').on(table.platform),
    uniqueIndex('devices_token_uq').on(table.fcmToken),
    uniqueIndex('devices_voip_token_uq').on(table.voipToken),
    uniqueIndex('devices_user_device_uq').on(table.userId, table.deviceId),
  ]
);

// 3. MASJIDS: profile, location and approval state
export const masjids = pgTable(
  'masjids',
  {
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
    ownerId: uuid('owner_id').references(() => users.id).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    description: text('description'),
    address: text('address'),
    city: varchar('city', { length: 100 }),
    country: varchar('country', { length: 100 }),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    contactEmail: varchar('contact_email', { length: 255 }),
    contactPhone: varchar('contact_phone', { length: 32 }),
    logoUrl: text('logo_url'),
    isApproved: boolean('is_approved').default(false).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('masjids_slug_uq').on(table.slug),
    index('masjids_city_idx').on(table.city),
    index('masjids_country_idx').on(table.country),
    index('masjids_owner_idx').on(table.ownerId),
    index('masjids_approved_idx').on(table.isApproved),
    index('masjids_lat_long_idx').on(table.latitude, table.longitude),
  ]
);

// 4. MASJID ADMINS: supports multiple admins/operators per masjid
export const masjidAdmins = pgTable(
  'masjid_admins',
  {
    masjidId: uuid('masjid_id').references(() => masjids.id, { onDelete: 'cascade' }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    role: masjidAdminRoleEnum('role').notNull().default('manager'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('masjid_admins_uq').on(table.masjidId, table.userId),
    index('masjid_admins_user_idx').on(table.userId),
  ]
);

// 5. MASJID REQUESTS: registration requests awaiting approval
export const masjidRequests = pgTable(
  'masjid_requests',
  {
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
    requesterId: uuid('requester_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    address: text('address'),
    city: varchar('city', { length: 100 }),
    country: varchar('country', { length: 100 }),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    contactEmail: varchar('contact_email', { length: 255 }),
    contactPhone: varchar('contact_phone', { length: 32 }),
    logoUrl: text('logo_url'),
    imamName: varchar('imam_name', { length: 255 }),
    imamEmail: varchar('imam_email', { length: 255 }),
    imamPhone: varchar('imam_phone', { length: 32 }),
    muazzinName: varchar('muazzin_name', { length: 255 }),
    muazzinEmail: varchar('muazzin_email', { length: 255 }),
    muazzinPhone: varchar('muazzin_phone', { length: 32 }),
    status: masjidRequestStatusEnum('status').notNull().default('pending'),
    reviewerId: uuid('reviewer_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('masjid_requests_status_idx').on(table.status),
    index('masjid_requests_requester_idx').on(table.requesterId),
  ]
);

// 6. MASJID STAFF: Imam/Muazzin contact details
export const masjidStaff = pgTable(
  'masjid_staff',
  {
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
    masjidId: uuid('masjid_id').references(() => masjids.id, { onDelete: 'cascade' }).notNull(),
    role: masjidAdminRoleEnum('role').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 32 }),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('masjid_staff_role_uq').on(table.masjidId, table.role),
    index('masjid_staff_masjid_idx').on(table.masjidId),
  ]
);

// 5. SUBSCRIPTIONS: follow + granular notification preferences
export const subscriptions = pgTable(
  'subscriptions',
  {
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    masjidId: uuid('masjid_id').references(() => masjids.id, { onDelete: 'cascade' }).notNull(),
    preferences: jsonb('preferences').default({}).notNull(),
    isMuted: boolean('is_muted').default(false).notNull(),
    muteUntil: timestamp('mute_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('subscriptions_uq').on(table.userId, table.masjidId),
    index('subscriptions_user_idx').on(table.userId),
    index('subscriptions_masjid_idx').on(table.masjidId),
  ]
);

// 6. SCHEDULES: daily prayer schedule, indexed for cron evaluation
export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
    masjidId: uuid('masjid_id').references(() => masjids.id, { onDelete: 'cascade' }).notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    prayerName: prayerNameEnum('prayer_name').notNull(),
    time: time('time').notNull(),
    adhanAtUtc: timestamp('adhan_at_utc', { withTimezone: true }).notNull(),
    iqamahAtUtc: timestamp('iqamah_at_utc', { withTimezone: true }),
    khutbahAtUtc: timestamp('khutbah_at_utc', { withTimezone: true }),
    isJuma: boolean('is_juma').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('schedule_day_prayer_uq').on(table.masjidId, table.date, table.prayerName),
    index('schedule_date_idx').on(table.masjidId, table.date),
    index('schedule_adhan_utc_idx').on(table.adhanAtUtc),
    index('schedule_khutbah_utc_idx').on(table.khutbahAtUtc),
  ]
);

// 6b. SCHEDULE TEMPLATES: recurring daily times per prayer
export const scheduleTemplates = pgTable(
  'schedule_templates',
  {
    masjidId: uuid('masjid_id').references(() => masjids.id, { onDelete: 'cascade' }).notNull(),
    prayerName: prayerNameEnum('prayer_name').notNull(),
    adhanTimeLocal: time('adhan_time_local').notNull(),
    iqamahTimeLocal: time('iqamah_time_local'),
    khutbahTimeLocal: time('khutbah_time_local'),
    isJuma: boolean('is_juma').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('schedule_templates_uq').on(table.masjidId, table.prayerName),
    index('schedule_templates_masjid_idx').on(table.masjidId),
  ]
);

// 7. BROADCASTS: live audio events + scheduling metadata
export const broadcasts = pgTable(
  'broadcasts',
  {
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
    masjidId: uuid('masjid_id').references(() => masjids.id, { onDelete: 'cascade' }).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    title: varchar('title', { length: 255 }),
    prayerName: prayerNameEnum('prayer_name'),
    status: broadcastStatusEnum('status').default('pending').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    streamProvider: varchar('stream_provider', { length: 64 }).default('livekit'),
    streamRoomId: varchar('stream_room_id', { length: 255 }),
    audioUrl: text('audio_url'),
    hlsUrl: text('hls_url'),
    hlsEgressId: varchar('hls_egress_id', { length: 255 }),
    hlsRtmpUrl: text('hls_rtmp_url'),
    recordingUrl: text('recording_url'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedReason: varchar('ended_reason', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('broadcasts_masjid_status_idx').on(table.masjidId, table.status),
    index('broadcasts_scheduled_idx').on(table.scheduledAt),
    index('broadcasts_started_idx').on(table.startedAt),
  ]
);

// 8. NOTIFICATION LOGS: audit of push delivery at scale
export const notificationLogs = pgTable(
  'notification_logs',
  {
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    deviceId: uuid('device_id').references(() => userDevices.id, { onDelete: 'set null' }),
    masjidId: uuid('masjid_id').references(() => masjids.id, { onDelete: 'set null' }),
    broadcastId: uuid('broadcast_id').references(() => broadcasts.id, { onDelete: 'set null' }),
    status: notificationStatusEnum('status').default('queued').notNull(),
    provider: varchar('provider', { length: 64 }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('notification_broadcast_idx').on(table.broadcastId),
    index('notification_user_idx').on(table.userId),
    index('notification_status_idx').on(table.status),
  ]
);

// 9. REFRESH TOKENS: hashed, revokable tokens
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    tokenHash: text('token_hash').notNull(),
    deviceId: uuid('device_id').references(() => userDevices.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('refresh_tokens_hash_uq').on(table.tokenHash),
    index('refresh_tokens_user_idx').on(table.userId),
    index('refresh_tokens_expiry_idx').on(table.expiresAt),
  ]
);