export function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    workspaceId: String(user.workspaceId),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

export function toPublicWorkspace(workspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    createdAt: workspace.createdAt,
  };
}
