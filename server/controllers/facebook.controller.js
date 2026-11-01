import { env } from '../config/env.js';
import {
  disconnectConnection,
  listConnections,
  markDeauthorized,
  verifyConnection,
} from '../services/facebookConnection.service.js';
import {
  completeAuthorization,
  OAuthFlowError,
  startAuthorization,
} from '../services/facebookOAuth.service.js';
import {
  connectPage,
  disconnectPage,
  listAvailablePages,
  listPages,
  verifyPage,
} from '../services/facebookPage.service.js';
import { MetaApiError } from '../services/meta/graphClient.js';
import { REQUIRED_SCOPES } from '../services/meta/scopes.js';
import { AppError } from '../utils/AppError.js';
import {
  clearOAuthStateCookie,
  readOAuthStateCookie,
  setOAuthStateCookie,
} from '../utils/cookies.js';
import { toAvailablePage, toPublicConnection, toPublicPage } from '../utils/serializers.js';
import { parseSignedRequest } from '../utils/signedRequest.js';

const asString = (value) => (typeof value === 'string' ? value : undefined);

function connectionsPage(params) {
  const url = new URL('/connections', env.frontendOrigins[0]);
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

export async function listFacebookConnections(req, res) {
  const connections = await listConnections(req.workspaceId);
  res.json({
    configured: Boolean(env.meta),
    requiredScopes: REQUIRED_SCOPES,
    connections: connections.map(toPublicConnection),
  });
}

export async function connectFacebook(req, res) {
  const { state, authorizationUrl } = await startAuthorization({
    userId: req.user._id,
    workspaceId: req.workspaceId,
  });

  setOAuthStateCookie(res, state);
  res.json({ authorizationUrl });
}

/**
 * Where Facebook sends the browser after login. It is a plain navigation, so there is no Bearer
 * token: the request is identified by the state cookie and the stored state. Every outcome is a
 * redirect back to the app with a short reason code; tokens and Facebook errors never go in a URL.
 */
export async function oauthCallback(req, res) {
  const cookieState = readOAuthStateCookie(req);
  clearOAuthStateCookie(res);

  try {
    if (!env.meta) throw new OAuthFlowError('config');

    await completeAuthorization({
      state: asString(req.query.state),
      cookieState,
      code: asString(req.query.code),
      providerError: asString(req.query.error),
    });
    res.redirect(connectionsPage({ facebook: 'connected' }));
  } catch (err) {
    let reason = 'internal';
    if (err instanceof OAuthFlowError) reason = err.reason;
    else if (err instanceof MetaApiError)
      reason = err.kind === 'unavailable' ? 'unavailable' : 'exchange';

    if (reason === 'internal') req.log.error({ err }, 'Facebook OAuth callback failed');
    res.redirect(connectionsPage({ facebook: 'error', reason }));
  }
}

export async function listFacebookPages(req, res) {
  const pages = await listPages(req.workspaceId);
  res.json({ pages: pages.map(toPublicPage) });
}

export async function listAvailableFacebookPages(req, res) {
  const available = await listAvailablePages(req.workspaceId, req.params.connectionId);
  res.json({
    pages: available.map(({ page, ...flags }) => toAvailablePage(page, flags)),
  });
}

export async function connectFacebookPage(req, res) {
  const page = await connectPage(req.workspaceId, req.user._id, req.body);
  res.status(201).json({ page: toPublicPage(page) });
}

export async function checkFacebookPage(req, res) {
  const page = await verifyPage(req.workspaceId, req.params.pageId);
  res.json({ page: toPublicPage(page) });
}

export async function disconnectFacebookPage(req, res) {
  await disconnectPage(req.workspaceId, req.params.pageId);
  res.status(204).end();
}

export async function checkConnection(req, res) {
  const connection = await verifyConnection(req.workspaceId, req.params.connectionId);
  res.json({ connection: toPublicConnection(connection) });
}

export async function disconnectFacebook(req, res) {
  await disconnectConnection(req.workspaceId, req.params.connectionId);
  res.status(204).end();
}

/** Meta calls this when a user removes the app from their Facebook settings. */
export async function deauthorize(req, res) {
  const payload = parseSignedRequest(req.body?.signed_request, env.meta.appSecret);
  const facebookUserId = String(payload?.user_id ?? '');
  if (!payload || !/^\d+$/.test(facebookUserId)) {
    throw new AppError(400, 'INVALID_SIGNED_REQUEST', 'Invalid signed request');
  }

  await markDeauthorized(facebookUserId);
  res.status(200).json({});
}
