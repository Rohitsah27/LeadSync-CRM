import { changePassword, getProfile, updateProfile } from '../services/user.service.js';
import { toPublicUser, toPublicWorkspace } from '../utils/serializers.js';
import { requestMeta, sendSession } from './auth.controller.js';

export async function getMe(req, res) {
  const { user, workspace } = await getProfile(req.user);
  res.json({ user: toPublicUser(user), workspace: toPublicWorkspace(workspace) });
}

export async function updateMe(req, res) {
  const user = await updateProfile(req.user, req.body);
  res.json({ user: toPublicUser(user) });
}

export async function updateMyPassword(req, res) {
  sendSession(res, await changePassword(req.user, req.body, requestMeta(req)));
}
