import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { verifyAccessToken } from '../services/token.service.js';
import { AppError } from '../utils/AppError.js';

const invalidToken = () => new AppError(401, 'INVALID_TOKEN', 'Invalid access token');

/**
 * Authenticates a Bearer access token and loads the user from the database, so deactivated
 * accounts and password changes take effect immediately. Sets `req.user` and `req.workspaceId`.
 */
export async function requireAuth(req, _res, next) {
  const match = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '');
  if (!match) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');

  const claims = verifyAccessToken(match[1]);
  if (!mongoose.isValidObjectId(claims.sub)) throw invalidToken();

  // The token identifies the user; the workspace is read from that user, never from the request.
  const user = await User.findById(claims.sub).unscoped();
  if (!user?.isActive) throw invalidToken();

  if (user.passwordChangedAt && claims.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
    throw invalidToken();
  }

  req.user = user;
  req.workspaceId = user.workspaceId;
  next();
}
