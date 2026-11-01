import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export function createRateLimiter({ windowMs, max, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit: max,
    skipSuccessfulRequests,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new AppError(429, 'RATE_LIMITED', 'Too many requests, please try again later'));
    },
  });
}

export const apiLimiter = createRateLimiter(env.rateLimit);

// Only failed attempts count, so a real user is not locked out by successful sign-ins.
export const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.auth.rateLimitMax,
  skipSuccessfulRequests: true,
});

export const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: env.auth.rateLimitMax,
});
