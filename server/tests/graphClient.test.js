import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import {
  buildDialogUrl,
  debugToken,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getProfile,
  MetaApiError,
  revokePermissions,
} from '../services/meta/graphClient.js';
import { graphError, mockGraph, reply } from './helpers/graphMock.js';

const { appId, appSecret } = env.meta;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requests', () => {
  it('exchanges an authorization code with the app credentials and no access token', async () => {
    const { calls } = mockGraph({ 'GET /oauth/access_token': reply({ access_token: 'T' }) });

    await exchangeCodeForToken('CODE123');

    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: env.meta.redirectUri,
      code: 'CODE123',
    });
  });

  it('asks for a long-lived token with fb_exchange_token', async () => {
    const { calls } = mockGraph({ 'GET /oauth/access_token': reply({ access_token: 'L' }) });

    await exchangeForLongLivedToken('SHORT');

    expect(calls[0].params).toMatchObject({
      grant_type: 'fb_exchange_token',
      fb_exchange_token: 'SHORT',
      client_id: appId,
    });
  });

  it('signs user-token calls with a correct appsecret_proof', async () => {
    const { calls } = mockGraph({ 'GET /me': reply({ id: '1', name: 'Fiona' }) });

    await getProfile('USER_TOKEN');

    const expected = crypto.createHmac('sha256', appSecret).update('USER_TOKEN').digest('hex');
    expect(calls[0].params).toMatchObject({
      access_token: 'USER_TOKEN',
      appsecret_proof: expected,
      fields: 'id,name',
    });
  });

  it('inspects a token with the app token and no proof', async () => {
    const { calls } = mockGraph({ 'GET /debug_token': reply({ data: { is_valid: true } }) });

    const data = await debugToken('INSPECTED');

    expect(data).toEqual({ is_valid: true });
    expect(calls[0].params).toEqual({
      input_token: 'INSPECTED',
      access_token: `${appId}|${appSecret}`,
    });
  });

  it('revokes permissions with a DELETE on the user', async () => {
    const { calls } = mockGraph({ 'DELETE /555/permissions': reply({ success: true }) });

    await revokePermissions('555', 'USER_TOKEN');

    expect(calls[0]).toMatchObject({ method: 'DELETE', path: '/555/permissions' });
  });

  it('uses the configured Graph version and gives every request a timeout', async () => {
    const { fetchMock } = mockGraph({ 'GET /me': reply({}) });

    await getProfile('T');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url).startsWith('https://graph.facebook.com/v25.0/me')).toBe(true);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('login dialog', () => {
  it('builds a Facebook Login for Business URL with config_id and no scope', () => {
    const url = new URL(buildDialogUrl('STATE123'));

    expect(url.origin).toBe('https://www.facebook.com');
    expect(url.pathname).toBe('/v25.0/dialog/oauth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: appId,
      redirect_uri: env.meta.redirectUri,
      state: 'STATE123',
      config_id: env.meta.loginConfigId,
      response_type: 'code',
      override_default_response_type: 'true',
    });
    expect(url.search).not.toContain(appSecret);
  });
});

describe('errors', () => {
  it('turns a Graph error into a MetaApiError with Meta’s identifiers', async () => {
    mockGraph({
      'GET /me': graphError(400, { code: 190, error_subcode: 463, message: 'Session has expired' }),
    });

    await expect(getProfile('T')).rejects.toMatchObject({
      name: 'MetaApiError',
      message: 'Session has expired',
      httpStatus: 400,
      code: 190,
      subcode: 463,
      fbtraceId: 'TRACE123',
      kind: 'auth',
    });
  });

  it.each([
    [400, 190, 'auth'],
    [400, 102, 'auth'],
    [403, 200, 'permission'],
    [403, 10, 'permission'],
    [400, 4, 'rate_limit'],
    [400, 17, 'rate_limit'],
    [400, 613, 'rate_limit'],
    [400, 80004, 'rate_limit'],
    [400, 100, 'invalid_request'],
    [500, 2, 'unavailable'],
    [400, 1, 'unavailable'],
    [503, undefined, 'unavailable'],
    [400, 999, 'unknown'],
  ])('classifies HTTP %i / code %s as %s', async (status, code, kind) => {
    mockGraph({ 'GET /me': graphError(status, { code }) });

    await expect(getProfile('T')).rejects.toMatchObject({ kind });
  });

  it('copes with a non-JSON error page from an upstream proxy', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>Bad gateway</html>', { status: 502 }));

    await expect(getProfile('T')).rejects.toMatchObject({ kind: 'unavailable', httpStatus: 502 });
  });

  it('reports an unreachable Facebook without leaking the request URL or token', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError(
        'fetch failed: https://graph.facebook.com/v25.0/me?access_token=SECRET_TOKEN',
      );
    });

    const error = await getProfile('SECRET_TOKEN').catch((err) => err);

    expect(error).toBeInstanceOf(MetaApiError);
    expect(error.kind).toBe('unavailable');
    expect(error.message).toBe('Could not reach Facebook');
    expect(JSON.stringify(error)).not.toContain('SECRET_TOKEN');
  });

  it('never puts a token in an error raised for a Graph failure', async () => {
    mockGraph({ 'GET /me': graphError(400, { code: 190 }) });

    const error = await getProfile('SECRET_TOKEN').catch((err) => err);

    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain('SECRET_TOKEN');
  });
});
