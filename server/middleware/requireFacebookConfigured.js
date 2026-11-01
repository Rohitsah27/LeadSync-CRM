import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export function requireFacebookConfigured(getConfig = () => env.meta) {
  return (_req, _res, next) => {
    if (!getConfig()) {
      return next(
        new AppError(503, 'FACEBOOK_NOT_CONFIGURED', 'Facebook integration is not configured'),
      );
    }
    next();
  };
}
