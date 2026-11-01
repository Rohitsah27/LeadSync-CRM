/** Validates and replaces `req.body` with the parsed result; failures become a 400 via the error handler. */
export const validateBody = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body);
  next();
};
