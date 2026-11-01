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

export function updateProfile(user, { name }) {
  return User.inWorkspace(user.workspaceId)
    .findOneAndUpdate({ _id: user._id }, { name }, { returnDocument: 'after', runValidators: true })
    .orFail();
}

/** Changes the password, signs out every device, and starts a fresh session for this one. */
export async function changePassword(user, { currentPassword, newPassword }, meta) {
  const account = await User.inWorkspace(user.workspaceId)
    .findById(user._id)
    .select('+passwordHash')
    .orFail();

  if (!(await verifyPassword(currentPassword, account.passwordHash))) {
    throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
  }

  account.passwordHash = await hashPassword(newPassword);
  account.passwordChangedAt = new Date();
  await account.save();
  await revokeAllUserTokens(account._id);

  return startSession(account, meta);
}
