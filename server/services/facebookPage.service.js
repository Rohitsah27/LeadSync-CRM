import { env } from '../config/env.js';
import { FacebookConnection } from '../models/FacebookConnection.js';
import { FacebookPage } from '../models/FacebookPage.js';
import { AppError } from '../utils/AppError.js';
import {
  inspectToken,
  toApiError,
  tokenAad,
  verifyConnection,
} from './facebookConnection.service.js';
import { getPageDetails, listManagedPages, MetaApiError } from './meta/graphClient.js';
import { tokenCrypto } from './tokenCrypto.js';

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;
const NUMERIC_ID = /^\d+$/;

const notReconnected = () =>
  new AppError(
    409,
    'CONNECTION_NOT_ACTIVE',
    'This Facebook connection needs to be reconnected before Pages can be managed',
  );
const pageNotFound = () => new AppError(404, 'NOT_FOUND', 'Facebook Page not found');
const pageInUse = () =>
  new AppError(
    409,
    'PAGE_IN_USE',
    'This Page is already connected to another LeadSync workspace. Disconnect it there first.',
  );

/** Binds an encrypted Page token to its workspace and Page, so it cannot be moved elsewhere. */
export const pageTokenAad = (workspaceId, pageId) => `fb-page-token:${workspaceId}:${pageId}`;

/** The connection's user token, only if the connection is still usable. */
async function loadUsableConnection(workspaceId, connectionId) {
  const connection = OBJECT_ID_HEX.test(connectionId)
    ? await FacebookConnection.inWorkspace(workspaceId)
        .findById(connectionId)
        .select('+userTokenCipher')
    : null;
  if (!connection) throw new AppError(404, 'NOT_FOUND', 'Facebook connection not found');
  if (connection.status !== 'active' || !connection.userTokenCipher) throw notReconnected();

  const token = tokenCrypto.decrypt(
    connection.userTokenCipher,
    tokenAad(connection.workspaceId, connection.facebookUserId),
  );
  return { connection, token };
}

/** Asks Facebook which Pages the account manages. Facebook, not LeadSync, decides who may see what. */
async function fetchManagedPages(workspaceId, connection, token) {
  try {
    return await listManagedPages(token);
  } catch (err) {
    if (err instanceof MetaApiError && err.kind === 'auth') {
      // The token stopped working: record it so every screen reflects it.
      await verifyConnection(workspaceId, connection.id).catch(() => null);
      throw notReconnected();
    }
    throw toApiError(err);
  }
}

/** Confirms Facebook issued a working token for this app. */
async function inspectPageToken(accessToken) {
  let info;
  try {
    info = await inspectToken(accessToken);
  } catch (err) {
    throw toApiError(err);
  }
  return info;
}

const isUsable = (info) => info.isValid && info.appId === env.meta.appId;

export function listPages(workspaceId) {
  return FacebookPage.inWorkspace(workspaceId).find().sort({ createdAt: 1 });
}

/** The Pages a connected Facebook account can manage, marked with what the workspace already has. */
export async function listAvailablePages(workspaceId, connectionId) {
  const { connection, token } = await loadUsableConnection(workspaceId, connectionId);
  const pages = await fetchManagedPages(workspaceId, connection, token);
  const pageIds = pages.map((page) => page.pageId);

  const ours = await FacebookPage.inWorkspace(workspaceId)
    .find({ pageId: { $in: pageIds } })
    .select('pageId');
  // Deliberately cross-workspace: only to say "taken", never to reveal who holds it.
  const taken = await FacebookPage.find({
    pageId: { $in: pageIds },
    workspaceId: { $ne: workspaceId },
    status: 'active',
  })
    .select('pageId')
    .unscoped();

  const connected = new Set(ours.map((page) => page.pageId));
  const inUseElsewhere = new Set(taken.map((page) => page.pageId));

  return pages.map((page) => ({
    page,
    connected: connected.has(page.pageId),
    inUseElsewhere: inUseElsewhere.has(page.pageId),
  }));
}

/**
 * A Page feeds one workspace at a time. Another workspace's claim blocks this one while it works,
 * but a claim whose token is dead cannot be used by anyone, so it is released to whoever can
 * prove (with a live token) that they manage the Page.
 */
async function releaseDeadClaim(workspaceId, pageId) {
  const claim = await FacebookPage.findOne({ pageId }).unscoped();
  if (!claim || String(claim.workspaceId) === String(workspaceId)) return;

  if (claim.status === 'active') throw pageInUse();
  await FacebookPage.deleteOne({ _id: claim._id }).unscoped();
}

export async function connectPage(workspaceId, userId, { connectionId, pageId }) {
  const { connection, token } = await loadUsableConnection(workspaceId, connectionId);
  const pages = await fetchManagedPages(workspaceId, connection, token);

  const page = pages.find((candidate) => candidate.pageId === pageId);
  if (!page) {
    throw new AppError(404, 'PAGE_NOT_FOUND', 'That Page is not managed by this Facebook account');
  }
  if (!page.accessToken) {
    throw new AppError(
      409,
      'PAGE_TOKEN_UNAVAILABLE',
      'Facebook did not give access to this Page. Check your role on the Page and reconnect.',
    );
  }

  const info = await inspectPageToken(page.accessToken);
  if (!isUsable(info)) {
    throw new AppError(
      409,
      'PAGE_TOKEN_INVALID',
      'Facebook did not issue a usable access token for this Page',
    );
  }

  await releaseDeadClaim(workspaceId, pageId);

  try {
    return await FacebookPage.inWorkspace(workspaceId).findOneAndUpdate(
      { pageId },
      {
        $set: {
          connectionId: connection._id,
          ...(page.name && { name: page.name }),
          ...(page.category && { category: page.category }),
          ...(page.pictureUrl && { pictureUrl: page.pictureUrl }),
          tasks: page.tasks ?? [],
          pageTokenCipher: tokenCrypto.encrypt(page.accessToken, pageTokenAad(workspaceId, pageId)),
          tokenExpiresAt: info.expiresAt,
          status: 'active',
          statusReason: null,
          lastVerifiedAt: new Date(),
          connectedBy: userId,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
  } catch (err) {
    // Two workspaces connecting the same Page at the same instant: the unique index picks one.
    throw err.code === 11000 ? pageInUse() : err;
  }
}

async function loadPage(workspaceId, pageId) {
  const page = NUMERIC_ID.test(pageId)
    ? await FacebookPage.inWorkspace(workspaceId).findOne({ pageId }).select('+pageTokenCipher')
    : null;
  if (!page) throw pageNotFound();
  return page;
}

const markInvalid = (workspaceId, page, reason) =>
  FacebookPage.inWorkspace(workspaceId).findOneAndUpdate(
    { _id: page._id },
    {
      $set: { status: 'invalid', statusReason: reason.slice(0, 300), lastVerifiedAt: new Date() },
      $unset: { pageTokenCipher: '' },
    },
    { returnDocument: 'after' },
  );

/** Re-checks a Page's token with Facebook, and refreshes its name and picture while there. */
export async function verifyPage(workspaceId, pageId) {
  const page = await loadPage(workspaceId, pageId);
  // Without a stored token there is nothing to check: it is already invalid.
  if (!page.pageTokenCipher) return page;

  const connection = await FacebookConnection.inWorkspace(workspaceId).findById(page.connectionId);
  if (connection?.status !== 'active') {
    return markInvalid(workspaceId, page, 'The Facebook connection needs to be reconnected');
  }

  const token = tokenCrypto.decrypt(page.pageTokenCipher, pageTokenAad(workspaceId, page.pageId));
  const info = await inspectPageToken(token);
  if (!isUsable(info)) {
    return markInvalid(
      workspaceId,
      page,
      info.error?.message ?? 'Facebook no longer accepts this Page access token',
    );
  }

  // Name and picture changes are cosmetic: failing to fetch them must not fail the check.
  const details = await getPageDetails(page.pageId, token).catch(() => null);

  return FacebookPage.inWorkspace(workspaceId).findOneAndUpdate(
    { _id: page._id },
    {
      $set: {
        ...(details?.name && { name: details.name }),
        ...(details?.category && { category: details.category }),
        ...(details?.pictureUrl && { pictureUrl: details.pictureUrl }),
        tokenExpiresAt: info.expiresAt,
        status: 'active',
        statusReason: null,
        lastVerifiedAt: new Date(),
      },
    },
    { returnDocument: 'after' },
  );
}

export async function disconnectPage(workspaceId, pageId) {
  const page = await loadPage(workspaceId, pageId);
  await FacebookPage.inWorkspace(workspaceId).deleteOne({ _id: page._id });
}

/**
 * After a Facebook connection is renewed, Pages that lost their token with it get a fresh one,
 * so reconnecting does not mean choosing every Page again.
 */
export async function restorePages(workspaceId, connection, userToken) {
  const dormant = await FacebookPage.inWorkspace(workspaceId)
    .find({ connectionId: connection._id, status: 'invalid' })
    .select('pageId');
  if (dormant.length === 0) return;

  const available = await listManagedPages(userToken);

  for (const { _id, pageId } of dormant) {
    const fresh = available.find((page) => page.pageId === pageId);
    if (!fresh?.accessToken) continue;

    const info = await inspectToken(fresh.accessToken);
    if (!isUsable(info)) continue;

    await FacebookPage.inWorkspace(workspaceId).updateOne(
      { _id },
      {
        $set: {
          pageTokenCipher: tokenCrypto.encrypt(
            fresh.accessToken,
            pageTokenAad(workspaceId, pageId),
          ),
          tokenExpiresAt: info.expiresAt,
          status: 'active',
          statusReason: null,
          lastVerifiedAt: new Date(),
        },
      },
    );
  }
}
