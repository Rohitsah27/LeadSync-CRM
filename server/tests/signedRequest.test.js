import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSignedRequest } from '../utils/signedRequest.js';
import { signedRequest } from './helpers/graphMock.js';

const SECRET = 'a-test-app-secret-value';
const payload = { algorithm: 'HMAC-SHA256', issued_at: 1700000000, user_id: '10001000100010' };

describe('parseSignedRequest', () => {
  it('returns the payload for a correctly signed request', () => {
    expect(parseSignedRequest(signedRequest(payload, SECRET), SECRET)).toEqual(payload);
  });

  it('rejects a request signed with a different secret', () => {
    expect(parseSignedRequest(signedRequest(payload, 'another-secret'), SECRET)).toBeNull();
  });

  it('rejects a payload that was altered after signing', () => {
    const [signature] = signedRequest(payload, SECRET).split('.');
    const forgedBody = Buffer.from(JSON.stringify({ ...payload, user_id: '999' })).toString(
      'base64url',
    );

    expect(parseSignedRequest(`${signature}.${forgedBody}`, SECRET)).toBeNull();
  });

  it('rejects an unsupported algorithm even if correctly signed', () => {
    const request = signedRequest({ ...payload, algorithm: 'HS512' }, SECRET);

    expect(parseSignedRequest(request, SECRET)).toBeNull();
  });

  it.each([
    ['undefined', undefined],
    ['a number', 42],
    ['an object', { signed_request: 'x' }],
    ['an empty string', ''],
    ['no dot', 'nodothere'],
    ['an empty signature', '.abc'],
    ['an empty payload', 'abc.'],
    ['extra parts', 'a.b.c'],
    ['a signature of the wrong length', 'AAAA.eyJhbGdvcml0aG0iOiJITUFDLVNIQTI1NiJ9'],
  ])('returns null for %s', (_label, value) => {
    expect(parseSignedRequest(value, SECRET)).toBeNull();
  });

  it('returns null when a correctly signed payload is not JSON', () => {
    const body = Buffer.from('this is not json').toString('base64url');
    const signature = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');

    expect(parseSignedRequest(`${signature}.${body}`, SECRET)).toBeNull();
  });
});
