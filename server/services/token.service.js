import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';

const ISSUER = 'leadsync-api';
const AUDIENCE = 'leadsync-web';
const DAY_MS = 24 * 60 * 60 * 1000;
// Two tabs can legitimately refresh with the same cookie at nearly the same moment.
const REUSE_GRACE_MS = 10_000;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const sessionExpired = () =>
  new AppError(401, 'INVALID_REFRESH_TOKEN', 'Your session has expired. Please sign in again.');

export function signAccessToken(userId) {
  return jwt.sign({}, env.auth.jwtSecret, {
    algorithm: 'HS256',
    subject: String(userId),
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.auth.accessTokenTtlSeconds,
  });
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.auth.jwtSecret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Access token expired');
    }
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid access token');
  }
}

export async function issueRefreshToken(user, { familyId = crypto.randomUUID(), meta = {} } = {}) {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.auth.refreshTokenTtlDays * DAY_MS);

  const record = await RefreshToken.create({
    userId: user._id,
    familyId,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 300),
    ip: meta.ip,
  });

  return { token, expiresAt, id: record._id };
}

export function revokeTokenFamily(familyId) {
  return RefreshToken.updateMany({ familyId, revokedAt: null }, { revokedAt: new Date() });
}

export function revokeAllUserTokens(userId) {
  return RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
}

export async function revokeByToken(token) {
  const record = await RefreshToken.findOne({ tokenHash: hashToken(token) });
  if (record) await revokeTokenFamily(record.familyId);
}

/**
 * Exchanges a refresh token for a new one in the same family. The old token is consumed
 * atomically, so only one concurrent request can win.
 */
export async function rotateRefreshToken(token, meta) {
  const tokenHash = hashToken(token);
  const now = new Date();

  const current = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
    { revokedAt: now, rotatedAt: now },
  );

  if (!current) {
    const known = await RefreshToken.findOne({ tokenHash });
    if (known?.rotatedAt && now - known.rotatedAt <= REUSE_GRACE_MS) {
      throw new AppError(409, 'REFRESH_CONFLICT', 'Session refresh already in progress');
    }
    // A token that was already rotated or revoked is being replayed: treat the session as stolen.
    if (known?.revokedAt) await revokeTokenFamily(known.familyId);
    throw sessionExpired();
  }

  const user = await User.findById(current.userId);
  if (!user?.isActive) {
    await revokeTokenFamily(current.familyId);
    throw sessionExpired();
  }

  const next = await issueRefreshToken(user, { familyId: current.familyId, meta });
  await RefreshToken.updateOne({ _id: current._id }, { replacedById: next.id });

  return { user, refresh: next };
}
