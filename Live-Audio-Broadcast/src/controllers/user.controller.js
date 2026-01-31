/**
 * User controller handlers.
 */
import { and, eq, ilike, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../utils/hash.js';
import { asyncHandler } from '../utils/async-handler.js';
import { ApiError } from '../utils/api-error.js';
import { ApiResponse } from '../utils/api-response.js';

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<void>}
 */
const getCurrentUser = asyncHandler(async (request, reply) => {
  const userId = request.user?.id || request.user?.sub;
  if (!userId) {
    throw new ApiError(401, 'unauthorized', 'Missing auth context');
  }

  const [currentUser] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      isVerified: users.isVerified,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!currentUser) {
    throw new ApiError(404, 'not_found', 'User not found');
  }

  return reply.status(200).send(new ApiResponse(200, 'User fetched', currentUser));
});

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<void>}
 */

const updateCurrentUser = asyncHandler(async (request, reply) => {
  const userId = request.user?.id || request.user?.sub;
  if (!userId) {
    throw new ApiError(401, 'unauthorized', 'Missing auth context');
  }

  const body = request.body;
  if (!body) {
    throw new ApiError(400, 'validation_error', 'Missing request body');
  }
  const { email, password, currentPassword } = body;
  if (!email && !password) {
    throw new ApiError(400, 'validation_error', 'No changes provided');
  }

  const [existingUser] = await db
    .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!existingUser) {
    throw new ApiError(404, 'not_found', 'User not found');
  }

  if (email && email !== existing.email) {
    const [emailTaken] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (emailTaken) {
      throw new ApiError(409, 'conflict', 'Email already in use');
    }
  }

  let nextPasswordHash = undefined;
  if (password) {
    const passwordMatches = await verifyPassword(currentPassword ?? '', existingUser.passwordHash);
    if (!passwordMatches) {
      throw new ApiError(400, 'invalid_credentials', 'Current password is incorrect');
    }
    nextPasswordHash = await hashPassword(password);
  }

  const [updatedUser] = await db
    .update(users)
    .set({
      email: email ?? existingUser.email,
      passwordHash: nextPasswordHash ?? existingUser.passwordHash,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      email: users.email,
      role: users.role,
      isVerified: users.isVerified,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    });

  return reply.status(200).send(new ApiResponse(200, 'User updated', updatedUser));
});

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<void>}
 */
const listUsers = asyncHandler(async (request, reply) => {
  const role = request.user?.role;
  if (role !== 'super_admin') {
    throw new ApiError(403, 'forbidden', 'Insufficient privileges');
  }

  const query = request.query;
  if (!query) {
    throw new ApiError(400, 'validation_error', 'Missing request query');
  }
  const { page = 1, limit = 50, search, role: roleFilter } = query;
  const offset = (page - 1) * limit;
  const userFilters = [];

  if (search) {
    userFilters.push(ilike(users.email, `%${search}%`));
  }
  if (roleFilter) {
    userFilters.push(eq(users.role, roleFilter));
  }

  const whereClause = userFilters.length ? and(...userFilters) : undefined;

  const [totalUsersRow] = await db
    .select({ total: sql`count(*)`.mapWith(Number) })
    .from(users)
    .where(whereClause);

  const userList = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      isVerified: users.isVerified,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(whereClause)
    .orderBy(users.createdAt)
    .limit(limit)
    .offset(offset);

  return reply.status(200).send(new ApiResponse(200, 'Users fetched', userList, {
    page,
    limit,
    total: totalUsersRow?.total ?? 0,
  }));
});

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<void>}
 */
const getUserById = asyncHandler(async (request, reply) => {
  const role = request.user?.role;
  if (role !== 'super_admin') {
    throw new ApiError(403, 'forbidden', 'Insufficient privileges');
  }

  const params = request.params;
  if (!params) {
    throw new ApiError(400, 'validation_error', 'Missing request params');
  }
  const { id } = params;
  const [userRecord] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      isVerified: users.isVerified,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!userRecord) {
    throw new ApiError(404, 'not_found', 'User not found');
  }

  return reply.status(200).send(new ApiResponse(200, 'User fetched', userRecord));
});

export {
  getCurrentUser,
  updateCurrentUser,
  listUsers,
  getUserById,
};
