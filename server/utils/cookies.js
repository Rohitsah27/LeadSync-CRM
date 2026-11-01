import { env } from '../config/env.js';

const REFRESH_COOKIE = 'ls_refresh';
const OAUTH_STATE_COOKIE = 'ls_oauth_state';
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

// Scoped to the auth routes so the refresh token is never sent with ordinary API calls.
const baseOptions = (path) => ({
  httpOnly: true,
  secure: env.auth.cookieSecure,
  sameSite: env.auth.cookieSameSite,
  path,
});

const refreshOptions = () => baseOptions('/api/v1/auth');
const oauthStateOptions = () => baseOptions('/api/v1/facebook/oauth');

export function setRefreshCookie(res, token, expiresAt) {
  res.cookie(REFRESH_COOKIE, token, { ...refreshOptions(), expires: expiresAt });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, refreshOptions());
}

export function readRefreshCookie(req) {
  const value = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Ties an OAuth attempt to the browser that started it; Facebook's redirect carries it back. */
export function setOAuthStateCookie(res, state) {
  res.cookie(OAUTH_STATE_COOKIE, state, { ...oauthStateOptions(), maxAge: OAUTH_STATE_MAX_AGE_MS });
}

export function clearOAuthStateCookie(res) {
  res.clearCookie(OAUTH_STATE_COOKIE, oauthStateOptions());
}

export function readOAuthStateCookie(req) {
  const value = req.cookies?.[OAUTH_STATE_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
