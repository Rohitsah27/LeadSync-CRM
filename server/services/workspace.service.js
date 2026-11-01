import { User } from '../models/User.js';
import { Workspace } from '../models/Workspace.js';
import { AppError } from '../utils/AppError.js';

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

export async function getWorkspaceSummary(workspaceId) {
  const [workspace, memberCount] = await Promise.all([
    Workspace.findById(workspaceId).orFail(),
    User.inWorkspace(workspaceId).countDocuments(),
  ]);
  return { workspace, memberCount };
}

export function renameWorkspace(workspaceId, { name }) {
  return Workspace.findByIdAndUpdate(
    workspaceId,
    { name },
    { returnDocument: 'after', runValidators: true },
  ).orFail();
}

export function listMembers(workspaceId) {
  return User.inWorkspace(workspaceId).find().sort({ createdAt: 1 });
}

/** A member of another workspace is reported as not found, so ids cannot be probed across tenants. */
export async function getMember(workspaceId, userId) {
  const member = OBJECT_ID_HEX.test(userId)
    ? await User.inWorkspace(workspaceId).findById(userId)
    : null;

  if (!member) throw new AppError(404, 'NOT_FOUND', 'Member not found');
  return member;
}
