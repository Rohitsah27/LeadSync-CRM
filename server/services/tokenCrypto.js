import crypto from 'node:crypto';
import { env } from '../config/env.js';

export class TokenCryptoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TokenCryptoError';
  }
}

const VERSION = 'v1';
const keyId = (key) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);

/**
 * AES-256-GCM encryption for secrets stored in the database (Meta access tokens).
 *
 * Output: `v1.<keyId>.<iv>.<authTag>.<ciphertext>` (base64url parts). Every call uses a fresh
 * random IV. `aad` binds the ciphertext to its owner (for example the workspace and Facebook
 * user), so a value copied onto another record fails to decrypt.
 *
 * Rotation: set the new key as `current` and keep the old one in `previous`. Old values keep
 * decrypting, and `needsReencryption()` flags them for rewriting.
 */
export function createTokenCrypto(config) {
  const keys = new Map();
  if (config) {
    for (const key of [config.current, ...config.previous]) keys.set(keyId(key), key);
  }
  const currentId = config ? keyId(config.current) : null;

  function requireConfig() {
    if (!config) throw new TokenCryptoError('Token encryption is not configured');
  }

  return {
    encrypt(plaintext, aad) {
      requireConfig();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', config.current, iv);
      cipher.setAAD(Buffer.from(aad));
      const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

      return [VERSION, currentId, iv, cipher.getAuthTag(), data]
        .map((part) => (Buffer.isBuffer(part) ? part.toString('base64url') : part))
        .join('.');
    },

    decrypt(payload, aad) {
      requireConfig();
      const [version, id, iv, tag, data, ...extra] = String(payload).split('.');
      const key = keys.get(id);
      if (version !== VERSION || !key || !data || extra.length > 0) {
        throw new TokenCryptoError('Unable to decrypt token');
      }

      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
        decipher.setAAD(Buffer.from(aad));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([
          decipher.update(Buffer.from(data, 'base64url')),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        throw new TokenCryptoError('Unable to decrypt token');
      }
    },

    needsReencryption(payload) {
      return String(payload).split('.')[1] !== currentId;
    },
  };
}

export const tokenCrypto = createTokenCrypto(env.tokenEncryption);
