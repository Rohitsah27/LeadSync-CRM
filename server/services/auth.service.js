import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Workspace } from '../models/Workspace.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword, verifyPassword } from './password.service.js';
import {
  issueRefreshToken,
  revokeByToken,
  rotateRefreshToken,
  signAccessToken,
} from './token.service.js';

const emailInUse = () =>
  new AppError(409, 'EMAIL_IN_USE', 'An account with this email already exists');

/** Issues an access token and a new refresh-token family for a signed-in user. */
export async function startSession(user, meta) {
  const workspace = await Workspace.findById(user.workspaceId).orFail();
  const refresh = await issueRefreshToken(user, { meta });

  return { user, workspace, accessToken: signAccessToken(user.id), refresh };
}

// Registration and sign-in find users by email before any workspace is known, hence .unscoped().
export async function registerUser({ name, businessName, email, password }, meta) {
  if (await User.exists({ email }).unscoped()) throw emailInUse();

  // The workspace and its owner reference each other, so the user id is chosen up front.
  const userId = new mongoose.Types.ObjectId();
  const workspace = await Workspace.create({ name: businessName, ownerId: userId });

  let user;
  try {
    user = await User.create({
      _id: userId,
      workspaceId: workspace._id,
      name,
      email,
      passwordHash: await hashPassword(password),
      role: 'owner',
    });
  } catch (err) {
    await Workspace.deleteOne({ _id: workspace._id });
    throw err.code === 11000 ? emailInUse() : err;
  }

  return startSession(user, meta);
}

export async function loginUser({ email, password }, meta) {
  const user = await User.findOne({ email }).select('+passwordHash').unscoped();
  const passwordMatches = await verifyPassword(password, user?.passwordHash);

  if (!user || !passwordMatches || !user.isActive) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  user.lastLoginAt = new Date();
  await User.inWorkspace(user.workspaceId).updateOne(
    { _id: user._id },
    { lastLoginAt: user.lastLoginAt },
  );

  return startSession(user, meta);
}

export async function refreshSession(refreshToken, meta) {
  const { user, refresh } = await rotateRefreshToken(refreshToken, meta);
  const workspace = await Workspace.findById(user.workspaceId).orFail();

  return { user, workspace, accessToken: signAccessToken(user.id), refresh };
}

export async function endSession(refreshToken) {
  if (refreshToken) await revokeByToken(refreshToken);
}
