import { User } from '../models/User.js';
import { Workspace } from '../models/Workspace.js';
import { AppError } from '../utils/AppError.js';
import { startSession } from './auth.service.js';
import { hashPassword, verifyPassword } from './password.service.js';
import { revokeAllUserTokens } from './token.service.js';

export async function getProfile(user) {
  const workspace = await Workspace.findById(user.workspaceId).orFail();
  return { user, workspace };
}

export async function updateProfile(userId, { name }) {
  return User.findByIdAndUpdate(userId, { name }, { returnDocument: 'after', runValidators: true });
}

/** Changes the password, signs out every device, and starts a fresh session for this one. */
export async function changePassword(userId, { currentPassword, newPassword }, meta) {
  const user = await User.findById(userId).select('+passwordHash');

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  await revokeAllUserTokens(user._id);

  return startSession(user, meta);
}
