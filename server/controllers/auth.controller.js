import { env } from '../config/env.js';
import { endSession, loginUser, refreshSession, registerUser } from '../services/auth.service.js';
import { revokeAllUserTokens } from '../services/token.service.js';
import { AppError } from '../utils/AppError.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../utils/cookies.js';
import { toPublicUser, toPublicWorkspace } from '../utils/serializers.js';

export const requestMeta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

/** Sets the refresh cookie and returns the session payload. The refresh token never goes in the body. */
export function sendSession(res, session) {
  setRefreshCookie(res, session.refresh.token, session.refresh.expiresAt);
  res.json({
    user: toPublicUser(session.user),
    workspace: toPublicWorkspace(session.workspace),
    accessToken: session.accessToken,
    expiresIn: env.auth.accessTokenTtlSeconds,
  });
}

export async function register(req, res) {
  const session = await registerUser(req.body, requestMeta(req));
  res.status(201);
  sendSession(res, session);
}

export async function login(req, res) {
  sendSession(res, await loginUser(req.body, requestMeta(req)));
}

export async function refresh(req, res) {
  const token = readRefreshCookie(req);
  if (!token) {
    throw new AppError(
      401,
      'INVALID_REFRESH_TOKEN',
      'Your session has expired. Please sign in again.',
    );
  }

  try {
    sendSession(res, await refreshSession(token, requestMeta(req)));
  } catch (err) {
    // A 409 means another request just rotated this token; clearing now would erase its new cookie.
    if (err instanceof AppError && err.statusCode === 401) clearRefreshCookie(res);
    throw err;
  }
}

export async function logout(req, res) {
  await endSession(readRefreshCookie(req));
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function logoutAll(req, res) {
  await revokeAllUserTokens(req.user._id);
  clearRefreshCookie(res);
  res.status(204).end();
}
