import { env } from '../config/env.js';
import { FacebookConnection } from '../models/FacebookConnection.js';
import { FacebookPage } from '../models/FacebookPage.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { debugToken, MetaApiError, revokePermissions } from './meta/graphClient.js';
import { tokenCrypto } from './tokenCrypto.js';

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;
// Meta's error subcode for "the user has not authorized this application".
const SUBCODE_APP_NOT_AUTHORIZED = 458;

const notFound = () => new AppError(404, 'NOT_FOUND', 'Facebook connection not found');

/** Page tokens come from the user's token, so they die with it: mark the Page and drop the token. */
const pagesLostConnection = () => ({
  $set: {
    status: 'invalid',
    statusReason: 'The Facebook connection needs to be reconnected',
    lastVerifiedAt: new Date(),
  },
  $unset: { pageTokenCipher: '' },
});

/** Binds an encrypted token to its workspace and Facebook user, so it cannot be moved elsewhere. */
export const tokenAad = (workspaceId, facebookUserId) =>
  `fb-user-token:${workspaceId}:${facebookUserId}`;

export function toApiError(err) {
  if (!(err instanceof MetaApiError)) return err;
  if (err.kind === 'rate_limit') {
    return new AppError(
      429,
      'FACEBOOK_RATE_LIMITED',
      'Facebook is limiting requests. Try again shortly.',
    );
  }
  return new AppError(
    502,
    'FACEBOOK_ERROR',
    'Facebook could not complete the request. Try again shortly.',
  );
}

export function listConnections(workspaceId) {
  return FacebookConnection.inWorkspace(workspaceId).find().sort({ createdAt: 1 });
}

/** Asks Facebook what a token is: who it belongs to, which app, what it may do and until when. */
export async function inspectToken(token) {
  const data = await debugToken(token);
  const toDate = (seconds) => (seconds ? new Date(seconds * 1000) : null);

  return {
    isValid: data.is_valid === true,
    appId: data.app_id ? String(data.app_id) : null,
    userId: data.user_id ? String(data.user_id) : null,
    scopes: Array.isArray(data.scopes) ? data.scopes : [],
    expiresAt: toDate(data.expires_at),
    dataAccessExpiresAt: toDate(data.data_access_expires_at),
    error: data.error
      ? { code: data.error.code, subcode: data.error.subcode, message: data.error.message }
      : null,
  };
}

/** Turns a token inspection into the update that keeps the stored connection truthful. */
function evaluate(info, connection) {
  const now = new Date();
  const dead = (status, reason) => ({
    $set: { status, statusReason: reason.slice(0, 300), lastVerifiedAt: now },
    $unset: { userTokenCipher: '' },
  });

  if (!info.isValid) {
    const revoked = info.error?.subcode === SUBCODE_APP_NOT_AUTHORIZED;
    return dead(
      revoked ? 'revoked' : 'expired',
      info.error?.message ?? 'Facebook no longer accepts this access token',
    );
  }
  if (info.appId !== env.meta.appId || info.userId !== connection.facebookUserId) {
    return dead('error', 'The stored token does not belong to this connection');
  }
  if (info.dataAccessExpiresAt && info.dataAccessExpiresAt <= now) {
    return dead('expired', 'Facebook data access has expired. Reconnect to renew it.');
  }

  return {
    $set: {
      status: 'active',
      statusReason: null,
      grantedScopes: info.scopes,
      tokenExpiresAt: info.expiresAt,
      dataAccessExpiresAt: info.dataAccessExpiresAt,
      lastVerifiedAt: now,
    },
  };
}

/** Re-checks a connection with Facebook and records whether it is still usable. */
export async function verifyConnection(workspaceId, connectionId) {
  const scoped = FacebookConnection.inWorkspace(workspaceId);
  const connection = OBJECT_ID_HEX.test(connectionId)
    ? await scoped.findById(connectionId).select('+userTokenCipher')
    : null;
  if (!connection) throw notFound();
  // Without a stored token there is nothing to check: it already expired or was revoked.
  if (!connection.userTokenCipher) return connection;

  const token = tokenCrypto.decrypt(
    connection.userTokenCipher,
    tokenAad(connection.workspaceId, connection.facebookUserId),
  );

  let info;
  try {
    info = await inspectToken(token);
  } catch (err) {
    throw toApiError(err);
  }

  const updated = await scoped.findOneAndUpdate(
    { _id: connection._id },
    evaluate(info, connection),
    { returnDocument: 'after' },
  );

  if (updated.status !== 'active') {
    await FacebookPage.inWorkspace(workspaceId).updateMany(
      { connectionId: connection._id },
      pagesLostConnection(),
    );
  }
  return updated;
}

/**
 * Removes a connection and its token. Facebook permissions are revoked as well unless another
 * workspace still uses the same Facebook account, because a revocation applies to every token
 * that account has issued to this app. Revocation is best effort: the token may already be dead.
 */
export async function disconnectConnection(workspaceId, connectionId) {
  const scoped = FacebookConnection.inWorkspace(workspaceId);
  const connection = OBJECT_ID_HEX.test(connectionId)
    ? await scoped.findById(connectionId).select('+userTokenCipher')
    : null;
  if (!connection) throw notFound();

  if (connection.userTokenCipher && env.meta) {
    // Deliberately cross-workspace: it asks whether anyone else relies on this Facebook account.
    const sharedWithOthers = await FacebookConnection.exists({
      facebookUserId: connection.facebookUserId,
      _id: { $ne: connection._id },
    }).unscoped();

    if (!sharedWithOthers) {
      try {
        const token = tokenCrypto.decrypt(
          connection.userTokenCipher,
          tokenAad(connection.workspaceId, connection.facebookUserId),
        );
        await revokePermissions(connection.facebookUserId, token);
      } catch (err) {
        logger.info(
          { code: err.code ?? null },
          'Could not revoke Facebook permissions on disconnect',
        );
      }
    }
  }

  // The Pages were authorized through this account, so they go with it.
  await FacebookPage.inWorkspace(workspaceId).deleteMany({ connectionId: connection._id });
  await scoped.deleteOne({ _id: connection._id });
}

/**
 * Meta's deauthorize callback: the user removed the app on Facebook, so every workspace that
 * connected that account loses access at once. Intentionally cross-workspace.
 */
export async function markDeauthorized(facebookUserId) {
  const connections = await FacebookConnection.find({ facebookUserId }).select('_id').unscoped();

  await FacebookConnection.updateMany(
    { facebookUserId },
    {
      $set: {
        status: 'revoked',
        statusReason: 'Access was removed on Facebook',
        lastVerifiedAt: new Date(),
      },
      $unset: { userTokenCipher: '' },
    },
  ).unscoped();

  await FacebookPage.updateMany(
    { connectionId: { $in: connections.map((connection) => connection._id) } },
    pagesLostConnection(),
  ).unscoped();
}
