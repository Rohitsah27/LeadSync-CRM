import crypto from 'node:crypto';

/**
 * Verifies and decodes the `signed_request` Meta sends to the deauthorize and data-deletion
 * callbacks. Returns the payload, or null if the signature or format is not valid.
 */
export function parseSignedRequest(signedRequest, appSecret) {
  if (typeof signedRequest !== 'string') return null;

  const [encodedSignature, encodedPayload, ...extra] = signedRequest.split('.');
  if (!encodedSignature || !encodedPayload || extra.length > 0) return null;

  const expected = crypto.createHmac('sha256', appSecret).update(encodedPayload).digest();
  const actual = Buffer.from(encodedSignature, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  return payload?.algorithm?.toUpperCase() === 'HMAC-SHA256' ? payload : null;
}
