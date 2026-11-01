import { env } from '../config/env.js';

const REFRESH_COOKIE = 'ls_refresh';

// Scoped to the auth routes so the refresh token is never sent with ordinary API calls.
const baseOptions = () => ({
  httpOnly: true,
  secure: env.auth.cookieSecure,
  sameSite: env.auth.cookieSameSite,
  path: '/api/v1/auth',
});

export function setRefreshCookie(res, token, expiresAt) {
  res.cookie(REFRESH_COOKIE, token, { ...baseOptions(), expires: expiresAt });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, baseOptions());
}

export function readRefreshCookie(req) {
  const value = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
