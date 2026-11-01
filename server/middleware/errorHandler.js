import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

export function notFound(_req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Route not found'));
}

function normalize(err) {
  if (err instanceof AppError) {
    return { status: err.statusCode, code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    };
  }
  if (err?.type === 'entity.parse.failed') {
    return { status: 400, code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
  }
  if (err?.type === 'entity.too.large') {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' };
}

// Express identifies error handlers by their four-argument signature.
export function errorHandler(err, req, res, _next) {
  const { status, code, message, details } = normalize(err);

  if (status >= 500) {
    (req.log ?? logger).error({ err }, 'Unhandled error');
  }

  res.status(status).json({ error: { code, message, details, requestId: req.id } });
}
