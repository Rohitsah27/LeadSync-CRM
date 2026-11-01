import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTokenCrypto, TokenCryptoError } from '../services/tokenCrypto.js';

const keyA = crypto.randomBytes(32);
const keyB = crypto.randomBytes(32);
const AAD = 'fb-user-token:workspace-1:user-1';

describe('tokenCrypto', () => {
  const crypt = createTokenCrypto({ current: keyA, previous: [] });

  it('round-trips a token', () => {
    const token = 'EAAB' + 'x'.repeat(180);

    expect(crypt.decrypt(crypt.encrypt(token, AAD), AAD)).toBe(token);
  });

  it('does not contain the plaintext and uses the versioned format', () => {
    const payload = crypt.encrypt('super-secret-token', AAD);

    expect(payload).not.toContain('super-secret-token');
    expect(payload.split('.')).toHaveLength(5);
    expect(payload.startsWith('v1.')).toBe(true);
  });

  it('uses a fresh IV every time', () => {
    const first = crypt.encrypt('same-token', AAD);
    const second = crypt.encrypt('same-token', AAD);

    expect(first).not.toBe(second);
    expect(crypt.decrypt(first, AAD)).toBe(crypt.decrypt(second, AAD));
  });

  it('refuses a ciphertext moved to another owner', () => {
    const payload = crypt.encrypt('token', AAD);

    expect(() => crypt.decrypt(payload, 'fb-user-token:workspace-2:user-1')).toThrow(
      TokenCryptoError,
    );
  });

  it('detects tampering with any part', () => {
    const [version, id, iv, tag, data] = crypt.encrypt('token', AAD).split('.');
    const flip = (part) => (part[0] === 'A' ? 'B' : 'A') + part.slice(1);

    for (const forged of [
      [version, id, flip(iv), tag, data],
      [version, id, iv, flip(tag), data],
      [version, id, iv, tag, flip(data)],
    ]) {
      expect(() => crypt.decrypt(forged.join('.'), AAD)).toThrow(TokenCryptoError);
    }
  });

  it.each([
    ['empty', ''],
    ['too few parts', 'v1.abc.def'],
    ['too many parts', 'v1.a.b.c.d.e'],
    ['an unknown version', 'v9.a.b.c.d'],
    ['an unknown key id', 'v1.deadbeef.AAAA.AAAA.AAAA'],
  ])('rejects a malformed payload (%s)', (_label, payload) => {
    expect(() => crypt.decrypt(payload, AAD)).toThrow(TokenCryptoError);
  });

  it('does not decrypt with a different key', () => {
    const other = createTokenCrypto({ current: keyB, previous: [] });

    expect(() => other.decrypt(crypt.encrypt('token', AAD), AAD)).toThrow(TokenCryptoError);
  });

  it('keeps old data readable after a key rotation and flags it for re-encryption', () => {
    const before = createTokenCrypto({ current: keyA, previous: [] });
    const old = before.encrypt('long-lived-token', AAD);

    const after = createTokenCrypto({ current: keyB, previous: [keyA] });

    expect(after.decrypt(old, AAD)).toBe('long-lived-token');
    expect(after.needsReencryption(old)).toBe(true);

    const fresh = after.encrypt('long-lived-token', AAD);
    expect(after.needsReencryption(fresh)).toBe(false);
    expect(after.decrypt(fresh, AAD)).toBe('long-lived-token');
  });

  it('stops reading old data once the retired key is removed', () => {
    const old = createTokenCrypto({ current: keyA, previous: [] }).encrypt('token', AAD);
    const rotatedOut = createTokenCrypto({ current: keyB, previous: [] });

    expect(() => rotatedOut.decrypt(old, AAD)).toThrow(TokenCryptoError);
  });

  it('fails clearly when no key is configured', () => {
    const unconfigured = createTokenCrypto(null);

    expect(() => unconfigured.encrypt('token', AAD)).toThrow(/not configured/);
    expect(() => unconfigured.decrypt('v1.a.b.c.d', AAD)).toThrow(/not configured/);
  });
});
