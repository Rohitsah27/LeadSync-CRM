import {
  getMember,
  getWorkspaceSummary,
  listMembers,
  renameWorkspace,
} from '../services/workspace.service.js';
import { toPublicMember, toPublicWorkspace } from '../utils/serializers.js';

// The workspace always comes from the authenticated user (req.workspaceId), never from the request.

export async function showWorkspace(req, res) {
  const { workspace, memberCount } = await getWorkspaceSummary(req.workspaceId);
  res.json({ workspace: toPublicWorkspace(workspace), memberCount, role: req.user.role });
}

export async function updateWorkspace(req, res) {
  const workspace = await renameWorkspace(req.workspaceId, req.body);
  res.json({ workspace: toPublicWorkspace(workspace) });
}

export async function showMembers(req, res) {
  const members = await listMembers(req.workspaceId);
  res.json({ members: members.map(toPublicMember) });
}

export async function showMember(req, res) {
  const member = await getMember(req.workspaceId, req.params.userId);
  res.json({ member: toPublicMember(member) });
}
