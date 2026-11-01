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

export function toPublicPage(page) {
  return {
    id: page.id,
    pageId: page.pageId,
    connectionId: String(page.connectionId),
    name: page.name ?? null,
    category: page.category ?? null,
    pictureUrl: page.pictureUrl ?? null,
    tasks: page.tasks,
    status: page.status,
    statusReason: page.statusReason ?? null,
    tokenExpiresAt: page.tokenExpiresAt ?? null,
    lastVerifiedAt: page.lastVerifiedAt ?? null,
    connectedAt: page.createdAt,
    connectedBy: String(page.connectedBy),
  };
}

/** A Page the Facebook account can manage, whether or not it has been connected yet. */
export function toAvailablePage(page, { connected, inUseElsewhere }) {
  return {
    pageId: page.pageId,
    name: page.name,
    category: page.category,
    pictureUrl: page.pictureUrl,
    tasks: page.tasks,
    // Lead retrieval needs Advertiser access on the Page; unknown when Facebook did not say.
    canRetrieveLeads: page.tasks ? page.tasks.includes('ADVERTISE') : null,
    connected,
    inUseElsewhere,
  };
}

export function toPublicWorkspace(workspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    createdAt: workspace.createdAt,
  };
}
