import { findMissingScopes } from '../services/meta/scopes.js';

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

export function toPublicMember(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

export function toPublicConnection(connection) {
  return {
    id: connection.id,
    facebookUserId: connection.facebookUserId,
    name: connection.name ?? null,
    status: connection.status,
    statusReason: connection.statusReason ?? null,
    grantedScopes: connection.grantedScopes,
    missingScopes: findMissingScopes(connection.grantedScopes),
    tokenExpiresAt: connection.tokenExpiresAt ?? null,
    dataAccessExpiresAt: connection.dataAccessExpiresAt ?? null,
    lastVerifiedAt: connection.lastVerifiedAt ?? null,
    connectedAt: connection.createdAt,
    connectedBy: String(connection.connectedBy),
  };
}

export function toPublicWorkspace(workspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    createdAt: workspace.createdAt,
  };
}
