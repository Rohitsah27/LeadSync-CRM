const FALLBACK = 'Something went wrong. Please try again.';

export function getErrorCode(error) {
  return error?.response?.data?.error?.code;
}

export function getErrorMessage(error, fallback = FALLBACK) {
  if (error?.response) return error.response.data?.error?.message ?? fallback;
  if (error?.request) return 'Unable to reach the server. Check your connection and try again.';
  return fallback;
}

/** Maps API validation details to `{ fieldName: message }`, keeping the first message per field. */
export function getFieldErrors(error) {
  const details = error?.response?.data?.error?.details;
  if (!Array.isArray(details)) return {};

  const errors = {};
  for (const { path, message } of details) {
    if (path && !(path in errors)) errors[path] = message;
  }
  return errors;
}
