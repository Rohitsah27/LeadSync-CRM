import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { FacebookConnection } from '../models/FacebookConnection.js';
import { OAUTH_STATE_TTL_SECONDS, OAuthState } from '../models/OAuthState.js';
import { logger } from '../utils/logger.js';
import { inspectToken, tokenAad } from './facebookConnection.service.js';
import { restorePages } from './facebookPage.service.js';
import {
  buildDialogUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getProfile,
} from './meta/graphClient.js';
import { tokenCrypto } from './tokenCrypto.js';

/** A failed OAuth attempt. `reason` is safe to show the user; it never carries Facebook details. */
export class OAuthFlowError extends Error {
  constructor(reason) {
    super(`Facebook OAuth failed: ${reason}`);
    this.name = 'OAuthFlowError';
    this.reason = reason;
  }
}

const hashState = (state) => crypto.createHash('sha256').update(state).digest('hex');

function sameValue(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Starts a connection attempt for a signed-in user and returns the Facebook dialog URL. */
export async function startAuthorization({ userId, workspaceId }) {
  const state = crypto.randomBytes(32).toString('base64url');
  await OAuthState.inWorkspace(workspaceId).create({ stateHash: hashState(state), userId });

  return { state, authorizationUrl: buildDialogUrl(state) };
}

/**
 * The state must match both the browser cookie and a stored single-use record. The cookie is what
 * stops an attacker from sending a victim down a flow the attacker started: the victim's browser
 * never received that cookie.
 */
async function consumeState(state, cookieState) {
  if (!state || !cookieState || !sameValue(state, cookieState)) throw new OAuthFlowError('state');

  // The callback arrives before any workspace is known; the state record is what identifies it.
  const record = await OAuthState.findOneAndDelete({ stateHash: hashState(state) }).unscoped();
  const isFresh =
    record && Date.now() - record.createdAt.getTime() <= OAUTH_STATE_TTL_SECONDS * 1000;
  if (!isFresh) throw new OAuthFlowError('state');

  return record;
}

/**
 * Finishes the login: validates the state, exchanges the code on the server, upgrades to a
 * long-lived token, confirms with Facebook whose token it is and what it grants, then stores it
 * encrypted. Granted permissions are recorded, not assumed.
 */
export async function completeAuthorization({ state, cookieState, code, providerError }) {
  const record = await consumeState(state, cookieState);
  if (providerError) throw new OAuthFlowError('denied');
  if (!code) throw new OAuthFlowError('exchange');

  const shortLived = await exchangeCodeForToken(code);
  const longLived = await exchangeForLongLivedToken(shortLived.access_token);
  const token = longLived.access_token;
  if (!token) throw new OAuthFlowError('exchange');

  const info = await inspectToken(token);
  if (!info.isValid || info.appId !== env.meta.appId || !info.userId) {
    throw new OAuthFlowError('exchange');
  }

  const profile = await getProfile(token).catch(() => null);
  const expiresAt =
    info.expiresAt ??
    (longLived.expires_in ? new Date(Date.now() + longLived.expires_in * 1000) : null);

  const connection = await FacebookConnection.inWorkspace(record.workspaceId).findOneAndUpdate(
    { facebookUserId: info.userId },
    {
      $set: {
        ...(profile?.name && { name: profile.name }),
        userTokenCipher: tokenCrypto.encrypt(token, tokenAad(record.workspaceId, info.userId)),
        tokenExpiresAt: expiresAt,
        dataAccessExpiresAt: info.dataAccessExpiresAt,
        grantedScopes: info.scopes,
        status: 'active',
        statusReason: null,
        lastVerifiedAt: new Date(),
        connectedBy: record.userId,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );

  // Renewing a connection should not mean choosing every Page again. This is a convenience, so a
  // failure here must not undo a login that succeeded.
  await restorePages(record.workspaceId, connection, token).catch((err) => {
    logger.warn({ code: err.code ?? null }, 'Could not restore Pages after reconnecting');
  });

  return connection;
}
