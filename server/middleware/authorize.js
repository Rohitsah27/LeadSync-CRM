import { USER_ROLES } from '../models/User.js';
import { AppError } from '../utils/AppError.js';

/**
 * Allows a request only for users whose role is `minimum` or higher (member < admin < owner).
 * Mount it after requireAuth: the role is read from the database on every request, so
 * demotions take effect immediately.
 */
export function requireRole(minimum) {
  const required = USER_ROLES.indexOf(minimum);
  if (required === -1) throw new Error(`Unknown role: ${minimum}`);

  return (req, _res, next) => {
    if (USER_ROLES.indexOf(req.user?.role) < required) {
      return next(new AppError(403, 'FORBIDDEN', 'You do not have permission to do this'));
    }
    next();
  };
}
