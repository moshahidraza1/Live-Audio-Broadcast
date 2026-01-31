// Auth controller handlers.
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users, refreshTokens } from '../db/schema.js';
import { env } from '../config/env.js';
import { hashPassword, verifyPassword } from '../utils/hash.js';
import { signAccessToken } from '../utils/jwt.js';
import { asyncHandler } from '../utils/async-handler.js';
import { ApiError } from '../utils/api-error.js';
import { ApiResponse } from '../utils/api-response.js';

const googleClient = env.GOOGLE_CLIENT_ID ? new OAuth2Client(env.GOOGLE_CLIENT_ID) : null;

// Hash refresh token before storing.
function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Parse TTL string like 7d/15m into ms.
function parseTtlToMs(ttl) {
  const match = /^([0-9]+)([smhd])$/.exec(ttl);
  if (!match) return 0;
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * multipliers[unit];
}

// Set refresh token cookie.
function setRefreshCookie(reply, refreshToken) {
  reply.setCookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    domain: env.COOKIE_DOMAIN,
    path: '/api/v1/auth',
  });
}

// Set access token cookie.
function setAccessCookie(reply, accessToken) {
  reply.setCookie('accessToken', accessToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    domain: env.COOKIE_DOMAIN,
    path: '/api/v1',
  });
}

// Clear refresh token cookie.
function clearRefreshCookie(reply) {
  reply.clearCookie('refreshToken', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    domain: env.COOKIE_DOMAIN,
    path: '/api/v1/auth',
  });
}

function clearAccessCookie(reply) {
  reply.clearCookie('accessToken', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    domain: env.COOKIE_DOMAIN,
    path: '/api/v1',
  });
}

function setCsrfCookie(reply) {
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  reply.setCookie(env.CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    domain: env.COOKIE_DOMAIN,
    path: '/api/v1',
  });
}

function clearCsrfCookie(reply) {
  reply.clearCookie(env.CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    domain: env.COOKIE_DOMAIN,
    path: '/api/v1',
  });
}

// Issue access JWT + opaque refresh token and persist hash.
async function issueTokens(userId, deviceId) {
  const [userRecord] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const accessToken = signAccessToken({ id: userId, role: userRecord?.role });
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const tokenHash = hashRefreshToken(refreshToken);
  const ttlMs = parseTtlToMs(env.REFRESH_TOKEN_TTL);
  const expiresAt = ttlMs ? new Date(Date.now() + ttlMs) : new Date(Date.now() + 7 * 86400000);

  // Store refresh token hash with expiry for rotation.
  await db.insert(refreshTokens).values({
    userId,
    tokenHash,
    deviceId,
    expiresAt,
  });

  return { accessToken, refreshToken };
}

// Validate refresh token hash and expiry.
async function validateRefreshToken(refreshToken) {
  const tokenHash = hashRefreshToken(refreshToken);
  const [storedRefreshToken] = await db
    .select({ userId: refreshTokens.userId, deviceId: refreshTokens.deviceId, expiresAt: refreshTokens.expiresAt })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);

  if (!storedRefreshToken) {
    throw new ApiError(401, 'invalid_token', 'Refresh token is invalid');
  }

  // Rotate expired tokens out of DB.
  if (storedRefreshToken.expiresAt && storedRefreshToken.expiresAt.getTime() < Date.now()) {
    await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));
    throw new ApiError(401, 'expired_token', 'Refresh token expired');
  }

  return { userId: storedRefreshToken.userId, deviceId: storedRefreshToken.deviceId ?? null };
}

// Remove refresh token hash from DB.
async function revokeRefreshToken(refreshToken) {
  const tokenHash = hashRefreshToken(refreshToken);
  await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));
}

// Register user with email + password.
const registerUser = asyncHandler(async (request, reply) => {
  const body = request.body;
  if (!body) {
    throw new ApiError(400, 'validation_error', 'Missing request body');
  }

  const { email, password } = body;
  // Enforce unique email.
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser) {
    throw new ApiError(409, 'conflict', 'Email already in use');
  }

  // Hash password before storing.
  const passwordHash = await hashPassword(password);
  const [createdUser] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      role: 'listener',
      isVerified: false,
    })
    .returning({
      id: users.id,
      email: users.email,
      role: users.role,
      isVerified: users.isVerified,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    });

  // Issue tokens and set refresh cookie.
  const { accessToken, refreshToken } = await issueTokens(createdUser.id, null);
  setRefreshCookie(reply, refreshToken);
  setAccessCookie(reply, accessToken);
  setCsrfCookie(reply);

  return reply.status(201).send(new ApiResponse(201, 'User registered', {
    user: createdUser,
  }));
});

// Login with email + password.
const loginUser = asyncHandler(async (request, reply) => {
  const body = request.body;
  if (!body) {
    throw new ApiError(400, 'validation_error', 'Missing request body');
  }

  const { email, password, deviceId } = body;
  const [existingUser] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      isVerified: users.isVerified,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!existingUser) {
    throw new ApiError(401, 'invalid_credentials', 'Invalid email or password');
  }

  // Compare provided password with stored hash.
  const passwordMatches = await verifyPassword(password, existingUser.passwordHash);
  if (!passwordMatches) {
    throw new ApiError(401, 'invalid_credentials', 'Invalid email or password');
  }

  // Track last login for audit.
  await db
    .update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, existingUser.id));

  // Issue tokens and set refresh cookie.
  const { accessToken, refreshToken } = await issueTokens(existingUser.id, deviceId ?? null);
  setRefreshCookie(reply, refreshToken);
  setAccessCookie(reply, accessToken);
  setCsrfCookie(reply);

  return reply.status(200).send(new ApiResponse(200, 'Login successful', {
    user: {
      id: existingUser.id,
      email: existingUser.email,
      role: existingUser.role,
      isVerified: existingUser.isVerified,
    },
  }));
});

// Rotate refresh token and return new access token.
const refreshSession = asyncHandler(async (request, reply) => {
  const refreshToken = request.cookies?.refreshToken;
  if (!refreshToken) {
    throw new ApiError(401, 'invalid_token', 'Missing refresh token');
  }

  // Validate and rotate refresh token.
  const { userId, deviceId } = await validateRefreshToken(refreshToken);
  await revokeRefreshToken(refreshToken);

  const { accessToken, refreshToken: newRefreshToken } = await issueTokens(userId, deviceId);
  setRefreshCookie(reply, newRefreshToken);
  setAccessCookie(reply, accessToken);
  setCsrfCookie(reply);

  return reply.status(200).send(new ApiResponse(200, 'Session refreshed'));
});

// Logout by revoking refresh token and clearing cookie.
const logoutUser = asyncHandler(async (request, reply) => {
  const refreshToken = request.cookies?.refreshToken;
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }
  clearRefreshCookie(reply);
  clearAccessCookie(reply);
  clearCsrfCookie(reply);
  return reply.status(200).send(new ApiResponse(200, 'Logged out'));
});

// Login or register via Google ID token.
const googleLogin = asyncHandler(async (request, reply) => {
  if (!googleClient) {
    throw new ApiError(500, 'oauth_not_configured', 'Google OAuth is not configured');
  }

  const body = request.body;
  if (!body) {
    throw new ApiError(400, 'validation_error', 'Missing request body');
  }

  const { idToken, deviceId } = body;
  // Verify Google ID token.
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new ApiError(401, 'invalid_token', 'Google token is invalid');
  }

  const email = payload.email;
  // Load or create the user by email.
  const [existingUser] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      isVerified: users.isVerified,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let userRecord = existingUser;
  if (!userRecord) {
    // Create a new local user for Google login.
    const [createdUser] = await db
      .insert(users)
      .values({
        email,
        passwordHash: await hashPassword(crypto.randomUUID()),
        role: 'listener',
        isVerified: payload.email_verified ?? true,
      })
      .returning({
        id: users.id,
        email: users.email,
        role: users.role,
        isVerified: users.isVerified,
      });
    userRecord = createdUser;
  }

  // Issue tokens and set refresh cookie.
  const { accessToken, refreshToken } = await issueTokens(userRecord.id, deviceId ?? null);
  setRefreshCookie(reply, refreshToken);
  setAccessCookie(reply, accessToken);

  return reply.status(200).send(new ApiResponse(200, 'Login successful', {
    user: userRecord,
    accessToken,
  }));
});

export {
  registerUser,
  loginUser,
  refreshSession,
  logoutUser,
  googleLogin,
};
