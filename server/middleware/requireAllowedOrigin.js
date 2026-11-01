import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const allowedOrigins = new Set(env.frontendOrigins);

/**
 * CSRF defence for endpoints that authenticate with the refresh cookie. Browsers always send
 * Origin on cross-site POSTs, so a foreign site cannot trigger these requests.
 */
export function requireAllowedOrigin(req, _res, next) {
  const { origin } = req.headers;
  if (origin && !allowedOrigins.has(origin)) {
    return next(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origin not allowed'));
  }
  next();
}
