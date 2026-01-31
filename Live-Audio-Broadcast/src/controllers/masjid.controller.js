// Masjid controller handlers.
import crypto from 'crypto';
import { and, eq, ilike, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { masjidAdmins, masjidRequests, masjidStaff, masjids, users } from '../db/schema.js';
import { redis } from '../config/redis.js';
import { asyncHandler } from '../utils/async-handler.js';
import { ApiError } from '../utils/api-error.js';
import { ApiResponse } from '../utils/api-response.js';

const MASJID_CACHE_TTL_SECONDS = 3600;
const STATIC_FIELDS = ['name', 'address', 'city', 'country', 'latitude', 'longitude'];

// Generate a URL-friendly slug from a name.
function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// Check if the user is allowed to manage a masjid.
async function requireMasjidAdmin(actorId, masjidId) {
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

// Ensure slug uniqueness by appending a short suffix if needed.
async function ensureUniqueSlug(baseSlug) {
  const [existing] = await db
    .select({ id: masjids.id })
    .from(masjids)
    .where(eq(masjids.slug, baseSlug))
    .limit(1);

  if (!existing) return baseSlug;
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${baseSlug}-${suffix}`;
}

// Write masjid profile into cache.
async function cacheMasjid(masjid) {
  const payload = JSON.stringify(masjid);
  await redis.setex(`masjid:${masjid.id}`, MASJID_CACHE_TTL_SECONDS, payload);
  await redis.setex(`masjid:slug:${masjid.slug}`, MASJID_CACHE_TTL_SECONDS, payload);
}

// Clear masjid cache entries.
async function clearMasjidCache(id, slug) {
  const keys = [`masjid:${id}`];
  if (slug) keys.push(`masjid:slug:${slug}`);
  await redis.del(keys);
}

// Submit a masjid registration request.
const createMasjid = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const body = request.body;
  if (!body) throw new ApiError(400, 'validation_error', 'Missing request body');

  const {
    name,
    description,
    address,
    city,
    country,
    latitude,
    longitude,
    timezone,
    contactEmail,
    contactPhone,
    logoUrl,
    imamName,
    imamEmail,
    imamPhone,
    muazzinName,
    muazzinEmail,
    muazzinPhone,
  } = body;

  if (!name || latitude === undefined || longitude === undefined) {
    throw new ApiError(400, 'validation_error', 'Missing required fields');
  }

  const resolvedTimezone = timezone ?? 'Asia/Kolkata';

  const [createdRequest] = await db
    .insert(masjidRequests)
    .values({
      name,
      description: description ?? null,
      address: address ?? null,
      city: city ?? null,
      country: country ?? null,
      latitude,
      longitude,
      timezone: resolvedTimezone,
      contactEmail: contactEmail ?? null,
      contactPhone: contactPhone ?? null,
      logoUrl: logoUrl ?? null,
      imamName: imamName ?? null,
      imamEmail: imamEmail ?? null,
      imamPhone: imamPhone ?? null,
      muazzinName: muazzinName ?? null,
      muazzinEmail: muazzinEmail ?? null,
      muazzinPhone: muazzinPhone ?? null,
      requesterId: actorId,
      status: 'pending',
    })
    .returning({
      id: masjidRequests.id,
      requesterId: masjidRequests.requesterId,
      name: masjidRequests.name,
      description: masjidRequests.description,
      address: masjidRequests.address,
      city: masjidRequests.city,
      country: masjidRequests.country,
      latitude: masjidRequests.latitude,
      longitude: masjidRequests.longitude,
      timezone: masjidRequests.timezone,
      contactEmail: masjidRequests.contactEmail,
      contactPhone: masjidRequests.contactPhone,
      logoUrl: masjidRequests.logoUrl,
      imamName: masjidRequests.imamName,
      imamEmail: masjidRequests.imamEmail,
      imamPhone: masjidRequests.imamPhone,
      muazzinName: masjidRequests.muazzinName,
      muazzinEmail: masjidRequests.muazzinEmail,
      muazzinPhone: masjidRequests.muazzinPhone,
      status: masjidRequests.status,
      createdAt: masjidRequests.createdAt,
      updatedAt: masjidRequests.updatedAt,
    });

  return reply.status(201).send(new ApiResponse(201, 'Masjid registration requested', createdRequest));
});

// Approve a masjid request and create masjid entity.
const approveMasjidRequest = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  const actorRole = request.user?.role;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');
  if (actorRole !== 'super_admin') throw new ApiError(403, 'forbidden', 'Insufficient privileges');

  const params = request.params;
  if (!params?.id) throw new ApiError(400, 'validation_error', 'Missing request id');
  const { id } = params;

  const [requestRecord] = await db
    .select({
      id: masjidRequests.id,
      requesterId: masjidRequests.requesterId,
      name: masjidRequests.name,
      description: masjidRequests.description,
      address: masjidRequests.address,
      city: masjidRequests.city,
      country: masjidRequests.country,
      latitude: masjidRequests.latitude,
      longitude: masjidRequests.longitude,
      timezone: masjidRequests.timezone,
      contactEmail: masjidRequests.contactEmail,
      contactPhone: masjidRequests.contactPhone,
      logoUrl: masjidRequests.logoUrl,
      imamName: masjidRequests.imamName,
      imamEmail: masjidRequests.imamEmail,
      imamPhone: masjidRequests.imamPhone,
      muazzinName: masjidRequests.muazzinName,
      muazzinEmail: masjidRequests.muazzinEmail,
      muazzinPhone: masjidRequests.muazzinPhone,
      status: masjidRequests.status,
    })
    .from(masjidRequests)
    .where(eq(masjidRequests.id, id))
    .limit(1);

  if (!requestRecord) throw new ApiError(404, 'not_found', 'Masjid request not found');
  if (requestRecord.status !== 'pending') {
    throw new ApiError(409, 'conflict', 'Masjid request already processed');
  }

  const baseSlug = slugify(requestRecord.name);
  const slug = await ensureUniqueSlug(baseSlug);

  const resolvedTimezone = requestRecord.timezone ?? 'Asia/Kolkata';

  const [createdMasjid] = await db
    .insert(masjids)
    .values({
      ownerId: requestRecord.requesterId,
      name: requestRecord.name,
      slug,
      description: requestRecord.description,
      address: requestRecord.address,
      city: requestRecord.city,
      country: requestRecord.country,
      latitude: requestRecord.latitude,
      longitude: requestRecord.longitude,
      timezone: resolvedTimezone,
      contactEmail: requestRecord.contactEmail,
      contactPhone: requestRecord.contactPhone,
      logoUrl: requestRecord.logoUrl,
      isApproved: true,
      isActive: true,
    })
    .returning({
      id: masjids.id,
      ownerId: masjids.ownerId,
      name: masjids.name,
      slug: masjids.slug,
      description: masjids.description,
      address: masjids.address,
      city: masjids.city,
      country: masjids.country,
      latitude: masjids.latitude,
      longitude: masjids.longitude,
      timezone: masjids.timezone,
      contactEmail: masjids.contactEmail,
      contactPhone: masjids.contactPhone,
      logoUrl: masjids.logoUrl,
      isApproved: masjids.isApproved,
      isActive: masjids.isActive,
      createdAt: masjids.createdAt,
      updatedAt: masjids.updatedAt,
    });

    await db.update(users).set({ role: 'masjid_admin' }).where(eq(users.id, requestRecord.requesterId));

  await db.insert(masjidAdmins).values({
    masjidId: createdMasjid.id,
    userId: requestRecord.requesterId,
    role: 'manager',
  });

  if (requestRecord.imamName || requestRecord.imamEmail || requestRecord.imamPhone) {
    await db.insert(masjidStaff).values({
      masjidId: createdMasjid.id,
      role: 'imam',
      name: requestRecord.imamName ?? 'Imam',
      email: requestRecord.imamEmail ?? null,
      phone: requestRecord.imamPhone ?? null,
      isActive: true,
    });
  }

  if (requestRecord.muazzinName || requestRecord.muazzinEmail || requestRecord.muazzinPhone) {
    await db.insert(masjidStaff).values({
      masjidId: createdMasjid.id,
      role: 'muazzin',
      name: requestRecord.muazzinName ?? 'Muazzin',
      email: requestRecord.muazzinEmail ?? null,
      phone: requestRecord.muazzinPhone ?? null,
      isActive: true,
    });
  }

  await db
    .update(masjidRequests)
    .set({
      status: 'approved',
      reviewerId: actorId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(masjidRequests.id, id));

  await cacheMasjid(createdMasjid);
  return reply.status(200).send(new ApiResponse(200, 'Masjid request approved', createdMasjid));
});

// Reject a masjid registration request.
const rejectMasjidRequest = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  const actorRole = request.user?.role;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');
  if (actorRole !== 'super_admin') throw new ApiError(403, 'forbidden', 'Insufficient privileges');

  const params = request.params;
  if (!params?.id) throw new ApiError(400, 'validation_error', 'Missing request id');
  const { id } = params;

  const body = request.body || {};
  const { reason } = body;

  const [requestRecord] = await db
    .select({ id: masjidRequests.id, status: masjidRequests.status })
    .from(masjidRequests)
    .where(eq(masjidRequests.id, id))
    .limit(1);

  if (!requestRecord) throw new ApiError(404, 'not_found', 'Masjid request not found');
  if (requestRecord.status !== 'pending') {
    throw new ApiError(409, 'conflict', 'Masjid request already processed');
  }

  await db
    .update(masjidRequests)
    .set({
      status: 'rejected',
      reviewerId: actorId,
      reviewedAt: new Date(),
      rejectionReason: reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(masjidRequests.id, id));

  return reply.status(200).send(new ApiResponse(200, 'Masjid request rejected'));
});

// List pending masjid requests (super_admin only).
const listPendingMasjidRequests = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  const actorRole = request.user?.role;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');
  if (actorRole !== 'super_admin') throw new ApiError(403, 'forbidden', 'Insufficient privileges');

  const query = request.query ?? {};
  const { page = 1, limit = 25, search } = query;
  const offset = (page - 1) * limit;
  const filters = [eq(masjidRequests.status, 'pending')];

  if (search) {
    filters.push(ilike(masjidRequests.name, `%${search}%`));
  }

  const whereClause = filters.length ? and(...filters) : undefined;

  const requests = await db
    .select({
      id: masjidRequests.id,
      requesterId: masjidRequests.requesterId,
      name: masjidRequests.name,
      description: masjidRequests.description,
      address: masjidRequests.address,
      city: masjidRequests.city,
      country: masjidRequests.country,
      latitude: masjidRequests.latitude,
      longitude: masjidRequests.longitude,
      timezone: masjidRequests.timezone,
      contactEmail: masjidRequests.contactEmail,
      contactPhone: masjidRequests.contactPhone,
      logoUrl: masjidRequests.logoUrl,
      imamName: masjidRequests.imamName,
      imamEmail: masjidRequests.imamEmail,
      imamPhone: masjidRequests.imamPhone,
      muazzinName: masjidRequests.muazzinName,
      muazzinEmail: masjidRequests.muazzinEmail,
      muazzinPhone: masjidRequests.muazzinPhone,
      status: masjidRequests.status,
      createdAt: masjidRequests.createdAt,
      updatedAt: masjidRequests.updatedAt,
    })
    .from(masjidRequests)
    .where(whereClause)
    .orderBy(masjidRequests.createdAt)
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db
    .select({ total: sql`count(*)`.mapWith(Number) })
    .from(masjidRequests)
    .where(whereClause);

  return reply.status(200).send(new ApiResponse(200, 'Pending masjid requests fetched', requests, {
    page,
    limit,
    total: totalRow?.total ?? 0,
  }));
});

// Upsert imam/muazzin details for a masjid.
const upsertMasjidStaff = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  const actorRole = request.user?.role;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const params = request.params;
  if (!params?.id) throw new ApiError(400, 'validation_error', 'Missing masjid id');
  const { id } = params;

  const body = request.body;
  if (!body) throw new ApiError(400, 'validation_error', 'Missing request body');

  if (actorRole !== 'super_admin') {
    const adminRecord = await requireMasjidAdmin(actorId, id);
    if (!['manager', 'imam'].includes(adminRecord.role)) {
      throw new ApiError(403, 'forbidden', 'Insufficient privileges');
    }
  }

  const { role, name, email, phone, isActive } = body;
  if (!role || !['imam', 'muazzin'].includes(role)) {
    throw new ApiError(400, 'validation_error', 'Invalid staff role');
  }
  if (!name) throw new ApiError(400, 'validation_error', 'Missing staff name');

  const [existingStaff] = await db
    .select({ id: masjidStaff.id })
    .from(masjidStaff)
    .where(and(eq(masjidStaff.masjidId, id), eq(masjidStaff.role, role)))
    .limit(1);

  if (existingStaff) {
    const [updatedStaff] = await db
      .update(masjidStaff)
      .set({
        name,
        email: email ?? null,
        phone: phone ?? null,
        isActive: isActive ?? true,
        updatedAt: new Date(),
      })
      .where(eq(masjidStaff.id, existingStaff.id))
      .returning({
        id: masjidStaff.id,
        masjidId: masjidStaff.masjidId,
        role: masjidStaff.role,
        name: masjidStaff.name,
        email: masjidStaff.email,
        phone: masjidStaff.phone,
        isActive: masjidStaff.isActive,
        createdAt: masjidStaff.createdAt,
        updatedAt: masjidStaff.updatedAt,
      });

    return reply.status(200).send(new ApiResponse(200, 'Masjid staff updated', updatedStaff));
    return;
  }

  const [createdStaff] = await db
    .insert(masjidStaff)
    .values({
      masjidId: id,
      role,
      name,
      email: email ?? null,
      phone: phone ?? null,
      isActive: isActive ?? true,
    })
    .returning({
      id: masjidStaff.id,
      masjidId: masjidStaff.masjidId,
      role: masjidStaff.role,
      name: masjidStaff.name,
      email: masjidStaff.email,
      phone: masjidStaff.phone,
      isActive: masjidStaff.isActive,
      createdAt: masjidStaff.createdAt,
      updatedAt: masjidStaff.updatedAt,
    });

  return reply.status(201).send(new ApiResponse(201, 'Masjid staff created', createdStaff));
});

// Remove imam/muazzin details.
const deleteMasjidStaff = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  const actorRole = request.user?.role;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const params = request.params;
  if (!params?.id || !params?.role) throw new ApiError(400, 'validation_error', 'Missing staff info');
  const { id, role } = params;

  if (!['imam', 'muazzin'].includes(role)) {
    throw new ApiError(400, 'validation_error', 'Invalid staff role');
  }

  if (actorRole !== 'super_admin') {
    const adminRecord = await requireMasjidAdmin(actorId, id);
    if (!['manager', 'imam'].includes(adminRecord.role)) {
      throw new ApiError(403, 'forbidden', 'Insufficient privileges');
    }
  }

  await db
    .delete(masjidStaff)
    .where(and(eq(masjidStaff.masjidId, id), eq(masjidStaff.role, role)));

  return reply.status(200).send(new ApiResponse(200, 'Masjid staff deleted'));
});

// Update masjid profile details.
const updateMasjid = asyncHandler(async (request, reply) => {
  const actorId = request.user?.id || request.user?.sub;
  const actorRole = request.user?.role;
  if (!actorId) throw new ApiError(401, 'unauthorized', 'Missing auth context');

  const body = request.body;
  if (!body) throw new ApiError(400, 'validation_error', 'Missing request body');

  const params = request.params;
  if (!params?.id) throw new ApiError(400, 'validation_error', 'Missing masjid id');
  const { id } = params;

  const [existingMasjid] = await db
    .select({
      id: masjids.id,
      ownerId: masjids.ownerId,
      slug: masjids.slug,
    })
    .from(masjids)
    .where(eq(masjids.id, id))
    .limit(1);

  if (!existingMasjid) throw new ApiError(404, 'not_found', 'Masjid not found');

  let masjidAdminRole = null;
  if (actorRole !== 'super_admin') {
    const adminRecord = await requireMasjidAdmin(actorId, id);
    masjidAdminRole = adminRecord.role;
  }

  const {
    name,
    description,
    address,
    city,
    country,
    latitude,
    longitude,
    timezone,
    contactEmail,
    contactPhone,
    logoUrl,
    isApproved,
    isActive,
  } = body;

  if (actorRole !== 'super_admin') {
    if (masjidAdminRole === 'muazzin') {
      throw new ApiError(403, 'forbidden', 'Muazzin cannot edit masjid profile');
    }

    const hasStaticChanges = STATIC_FIELDS.some((field) => body[field] !== undefined);
    if (hasStaticChanges) {
      throw new ApiError(403, 'forbidden', 'Only super admins can edit static masjid details');
    }

    if (isApproved !== undefined || isActive !== undefined) {
      throw new ApiError(403, 'forbidden', 'Only super admins can change approval state');
    }
  }

  let nextSlug = existingMasjid.slug;
  if (typeof name === 'string' && name.trim().length > 0) {
    nextSlug = await ensureUniqueSlug(slugify(name));
  }

  const updateValues = {
    updatedAt: new Date(),
  };

  if (name !== undefined) updateValues.name = name;
  if (nextSlug) updateValues.slug = nextSlug;
  if (description !== undefined) updateValues.description = description;
  if (address !== undefined) updateValues.address = address;
  if (city !== undefined) updateValues.city = city;
  if (country !== undefined) updateValues.country = country;
  if (latitude !== undefined) updateValues.latitude = latitude;
  if (longitude !== undefined) updateValues.longitude = longitude;
  if (timezone !== undefined) updateValues.timezone = timezone;
  if (contactEmail !== undefined) updateValues.contactEmail = contactEmail;
  if (contactPhone !== undefined) updateValues.contactPhone = contactPhone;
  if (logoUrl !== undefined) updateValues.logoUrl = logoUrl;
  if (actorRole === 'super_admin' && isApproved !== undefined) updateValues.isApproved = isApproved;
  if (actorRole === 'super_admin' && isActive !== undefined) updateValues.isActive = isActive;

  const [updatedMasjid] = await db
    .update(masjids)
    .set(updateValues)
    .where(eq(masjids.id, id))
    .returning({
      id: masjids.id,
      ownerId: masjids.ownerId,
      name: masjids.name,
      slug: masjids.slug,
      description: masjids.description,
      address: masjids.address,
      city: masjids.city,
      country: masjids.country,
      latitude: masjids.latitude,
      longitude: masjids.longitude,
      timezone: masjids.timezone,
      contactEmail: masjids.contactEmail,
      contactPhone: masjids.contactPhone,
      logoUrl: masjids.logoUrl,
      isApproved: masjids.isApproved,
      isActive: masjids.isActive,
      createdAt: masjids.createdAt,
      updatedAt: masjids.updatedAt,
    });

  await clearMasjidCache(id, existingMasjid.slug);
  await cacheMasjid(updatedMasjid);

  return reply.status(200).send(new ApiResponse(200, 'Masjid updated', updatedMasjid));
});

// Get masjid profile by id with cache.
const getMasjid = asyncHandler(async (request, reply) => {
  const params = request.params;
  if (!params?.id) throw new ApiError(400, 'validation_error', 'Missing masjid id');
  const { id } = params;

  const cached = await redis.get(`masjid:${id}`);
  if (cached) {
    return reply.status(200).send(new ApiResponse(200, 'Masjid fetched', JSON.parse(cached)));
    return;
  }

  const [masjidRecord] = await db
    .select({
      id: masjids.id,
      ownerId: masjids.ownerId,
      name: masjids.name,
      slug: masjids.slug,
      description: masjids.description,
      address: masjids.address,
      city: masjids.city,
      country: masjids.country,
      latitude: masjids.latitude,
      longitude: masjids.longitude,
      timezone: masjids.timezone,
      contactEmail: masjids.contactEmail,
      contactPhone: masjids.contactPhone,
      logoUrl: masjids.logoUrl,
      isApproved: masjids.isApproved,
      isActive: masjids.isActive,
      createdAt: masjids.createdAt,
      updatedAt: masjids.updatedAt,
    })
    .from(masjids)
    .where(eq(masjids.id, id))
    .limit(1);

  if (!masjidRecord) throw new ApiError(404, 'not_found', 'Masjid not found');

  await cacheMasjid(masjidRecord);
  return reply.status(200).send(new ApiResponse(200, 'Masjid fetched', masjidRecord));
});

// List masjids with filters and pagination.
const listMasjids = asyncHandler(async (request, reply) => {
  const query = request.query;
  if (!query) throw new ApiError(400, 'validation_error', 'Missing request query');

  const { page = 1, limit = 25, search, city, country, approved, active, ownerId } = query;
  const offset = (page - 1) * limit;
  const filters = [];

  if (search) {
    filters.push(ilike(masjids.name, `%${search}%`));
  }
  if (city) {
    filters.push(eq(masjids.city, city));
  }
  if (country) {
    filters.push(eq(masjids.country, country));
  }
  if (approved !== undefined) {
    const approvedValue = approved === true || approved === 'true';
    filters.push(eq(masjids.isApproved, approvedValue));
  }
  if (active !== undefined) {
    const activeValue = active === true || active === 'true';
    filters.push(eq(masjids.isActive, activeValue));
  }
  if (ownerId) {
    filters.push(eq(masjids.ownerId, ownerId));
  }

  const whereClause = filters.length ? and(...filters) : undefined;

  const masjidList = await db
    .select({
      id: masjids.id,
      ownerId: masjids.ownerId,
      name: masjids.name,
      slug: masjids.slug,
      description: masjids.description,
      address: masjids.address,
      city: masjids.city,
      country: masjids.country,
      latitude: masjids.latitude,
      longitude: masjids.longitude,
      timezone: masjids.timezone,
      contactEmail: masjids.contactEmail,
      contactPhone: masjids.contactPhone,
      logoUrl: masjids.logoUrl,
      isApproved: masjids.isApproved,
      isActive: masjids.isActive,
      createdAt: masjids.createdAt,
      updatedAt: masjids.updatedAt,
    })
    .from(masjids)
    .where(whereClause)
    .orderBy(masjids.name)
    .limit(limit)
    .offset(offset);

  const [totalMasjidsRow] = await db
    .select({ total: sql`count(*)`.mapWith(Number) })
    .from(masjids)
    .where(whereClause);

  return reply.status(200).send(new ApiResponse(200, 'Masjids fetched', masjidList, {
    page,
    limit,
    total: totalMasjidsRow?.total ?? 0,
  }));
});

export {
  createMasjid,
  approveMasjidRequest,
  rejectMasjidRequest,
  listPendingMasjidRequests,
  upsertMasjidStaff,
  deleteMasjidStaff,
  updateMasjid,
  getMasjid,
  listMasjids,
};
