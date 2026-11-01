import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';

const GRAPH_ORIGIN = 'https://graph.facebook.com';
const DIALOG_ORIGIN = 'https://www.facebook.com';
const TIMEOUT_MS = 10_000;

function classify({ httpStatus, code }) {
  if (code === 190 || code === 102) return 'auth';
  if (code === 10 || (code >= 200 && code <= 299)) return 'permission';
  if ([4, 17, 32, 613].includes(code) || (code >= 80000 && code <= 80014)) return 'rate_limit';
  if (code === 1 || code === 2 || !httpStatus || httpStatus >= 500) return 'unavailable';
  if (code === 100) return 'invalid_request';
  return 'unknown';
}

/** An error from Facebook, or from failing to reach it. `kind` groups Meta's many error codes. */
export class MetaApiError extends Error {
  constructor({ message, httpStatus = null, code = null, subcode = null, fbtraceId = null }) {
    super(message);
    this.name = 'MetaApiError';
    this.httpStatus = httpStatus;
    this.code = code;
    this.subcode = subcode;
    this.fbtraceId = fbtraceId;
    this.kind = classify({ httpStatus, code });
  }
}

function requireMeta() {
  if (!env.meta) {
    throw new AppError(503, 'FACEBOOK_NOT_CONFIGURED', 'Facebook integration is not configured');
  }
  return env.meta;
}

const appSecretProof = (token, appSecret) =>
  crypto.createHmac('sha256', appSecret).update(token).digest('hex');

/**
 * `token` is a user or Page token (sent with appsecret_proof); `appToken` is the app's own
 * `id|secret` credential. Tokens travel in the query string, as Meta documents, so URLs are
 * never logged: only the path and Meta's error identifiers are.
 */
async function graphRequest({ method = 'GET', path, params = {}, token, appToken }) {
  const { appSecret, graphVersion } = requireMeta();
  const url = new URL(`${GRAPH_ORIGIN}/${graphVersion}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  if (token) {
    url.searchParams.set('access_token', token);
    url.searchParams.set('appsecret_proof', appSecretProof(token, appSecret));
  } else if (appToken) {
    url.searchParams.set('access_token', appToken);
  }

  // One deadline covers connecting and reading the body, and the timer never outlives the request.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  let body;
  try {
    response = await fetch(url, {
      method,
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    body = await response.json().catch(() => null);
  } catch {
    logger.warn({ path }, 'Could not reach the Meta Graph API');
    throw new MetaApiError({ message: 'Could not reach Facebook' });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok || body?.error) {
    const error = body?.error ?? {};
    const failure = new MetaApiError({
      message: error.message ?? `Facebook returned HTTP ${response.status}`,
      httpStatus: response.status,
      code: error.code,
      subcode: error.error_subcode,
      fbtraceId: error.fbtrace_id,
    });
    logger.warn(
      {
        path,
        httpStatus: response.status,
        code: failure.code,
        subcode: failure.subcode,
        fbtraceId: failure.fbtraceId,
      },
      'Meta Graph API error',
    );
    throw failure;
  }

  return body;
}

/** The Facebook Login for Business dialog. `config_id` replaces `scope`. */
export function buildDialogUrl(state) {
  const { appId, graphVersion, loginConfigId, redirectUri } = requireMeta();
  const url = new URL(`${DIALOG_ORIGIN}/${graphVersion}/dialog/oauth`);

  url.search = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    config_id: loginConfigId,
    response_type: 'code',
    override_default_response_type: 'true',
  }).toString();

  return url.toString();
}

export function exchangeCodeForToken(code) {
  const { appId, appSecret, redirectUri } = requireMeta();
  return graphRequest({
    path: '/oauth/access_token',
    params: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
  });
}

export function exchangeForLongLivedToken(shortLivedToken) {
  const { appId, appSecret } = requireMeta();
  return graphRequest({
    path: '/oauth/access_token',
    params: {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedToken,
    },
  });
}

export async function debugToken(inputToken) {
  const { appId, appSecret } = requireMeta();
  const body = await graphRequest({
    path: '/debug_token',
    params: { input_token: inputToken },
    appToken: `${appId}|${appSecret}`,
  });
  return body.data ?? {};
}

export function getProfile(token) {
  return graphRequest({ path: '/me', params: { fields: 'id,name' }, token });
}

export function revokePermissions(facebookUserId, token) {
  return graphRequest({
    method: 'DELETE',
    path: `/${encodeURIComponent(facebookUserId)}/permissions`,
    token,
  });
}
