import crypto from 'node:crypto';

const PREFIX = 'sha256=';

/**
 * Checks Meta's `X-Hub-Signature-256` header: an HMAC-SHA256 of the exact bytes received, keyed
 * with the app secret. It must be computed over the raw body, not a re-serialised copy, because
 * Meta escapes some characters in a way JSON.stringify would not reproduce.
 */
export function isValidMetaSignature(rawBody, header, appSecret) {
  if (!Buffer.isBuffer(rawBody) || typeof header !== 'string' || !header.startsWith(PREFIX)) {
    return false;
  }

  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(header.slice(PREFIX.length), 'hex');

  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}
