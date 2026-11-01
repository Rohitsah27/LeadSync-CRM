/**
 * Validates `req.query` and exposes the parsed result as `req.validatedQuery` (Express 5 makes
 * `req.query` read-only). Repeated parameters arrive as arrays and fail validation.
 */
export const validateQuery = (schema) => (req, _res, next) => {
  req.validatedQuery = schema.parse(req.query);
  next();
};

/** Validates and replaces `req.body` with the parsed result; failures become a 400 via the error handler. */
export const validateBody = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body);
  next();
};
