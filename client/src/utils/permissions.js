const WORKSPACE_MANAGERS = new Set(['owner', 'admin']);

/** Only controls what the UI offers. The API enforces roles on every request. */
export function canManageWorkspace(role) {
  return WORKSPACE_MANAGERS.has(role);
}
