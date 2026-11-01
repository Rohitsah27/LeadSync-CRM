import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { FacebookConnection } from '../models/FacebookConnection.js';
import { OAuthState } from '../models/OAuthState.js';
import { User } from '../models/User.js';
import { requireFacebookConfigured } from '../middleware/requireFacebookConfigured.js';
import { tokenAad } from '../services/facebookConnection.service.js';
import { REQUIRED_SCOPES } from '../services/meta/scopes.js';
import { hashPassword } from '../services/password.service.js';
import { tokenCrypto } from '../services/tokenCrypto.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db.js';
import { graphError, mockGraph, reply, signedRequest } from './helpers/graphMock.js';

const app = createApp();
const API = '/api/v1';
const FB_USER = '10001000100010';
const OTHER_FB_USER = '20002000200020';
const SUCCESS_URL = 'https://app.leadsync.test/connections?facebook=connected';
const errorUrl = (reason) =>
  `https://app.leadsync.test/connections?facebook=error&reason=${reason}`;

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const inDays = (days) => Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
const cookieFrom = (res, name) =>
  res.headers['set-cookie']
    ?.find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0]
    .slice(name.length + 1);

const tokenInfo = (overrides = {}) => ({
  is_valid: true,
  app_id: env.meta.appId,
  user_id: FB_USER,
  scopes: [...REQUIRED_SCOPES, 'public_profile'],
  expires_at: inDays(60),
  data_access_expires_at: inDays(90),
  ...overrides,
});

/** A Graph API where the login succeeds. Pass route overrides to break individual steps. */
const graphRoutes = (overrides = {}) => ({
  'GET /oauth/access_token': ({ params }) =>
    params.grant_type === 'fb_exchange_token'
      ? reply({ access_token: 'LONG_TOKEN', token_type: 'bearer', expires_in: 5184000 })
      : reply({ access_token: 'SHORT_TOKEN', token_type: 'bearer' }),
  'GET /debug_token': () => reply({ data: tokenInfo() }),
  'GET /me': () => reply({ id: FB_USER, name: 'Fiona Business' }),
  [`DELETE /${FB_USER}/permissions`]: reply({ success: true }),
  ...overrides,
});

async function signUp(email, businessName) {
  const res = await request(app)
    .post(`${API}/auth/register`)
    .send({ name: 'Owner Person', businessName, email, password: 'owner-password-123' });
  return { token: res.body.accessToken, user: res.body.user, workspace: res.body.workspace };
}

async function addMember(workspaceId, email, role) {
  await User.inWorkspace(workspaceId).create({
    name: 'Team Mate',
    email,
    role,
    passwordHash: await hashPassword('member-password-1'),
  });
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: 'member-password-1' });
  return res.body.accessToken;
}

async function startConnect(token) {
  const res = await request(app).post(`${API}/facebook/connect`).set(bearer(token));
  const state =
    res.body.authorizationUrl && new URL(res.body.authorizationUrl).searchParams.get('state');
  return { res, state, cookie: cookieFrom(res, 'ls_oauth_state') };
}

function callback({ state, cookie, ...query }) {
  const req = request(app)
    .get(`${API}/facebook/oauth/callback`)
    .query({ state, ...query });
  return cookie ? req.set('Cookie', `ls_oauth_state=${cookie}`) : req;
}

/** Runs a full login for an account and returns the callback response. */
async function completeLogin(account, { code = 'AUTH_CODE', cookie } = {}) {
  const flow = await startConnect(account.token);
  return callback({ state: flow.state, cookie: cookie ?? flow.cookie, code });
}

const storedConnection = (workspaceId, facebookUserId = FB_USER) =>
  FacebookConnection.inWorkspace(workspaceId)
    .findOne({ facebookUserId })
    .select('+userTokenCipher');
const countAllConnections = () => FacebookConnection.countDocuments().unscoped();

let acme;
let globex;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(() => {
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  await clearTestDb();
  acme = await signUp('owner@acme.example', 'Acme Realty');
  globex = await signUp('owner@globex.example', 'Globex Autos');
});

describe('POST /facebook/connect', () => {
  it('requires authentication', async () => {
    expect((await request(app).post(`${API}/facebook/connect`)).status).toBe(401);
  });

  it('is limited to owners and admins', async () => {
    const memberToken = await addMember(acme.workspace.id, 'member@acme.example', 'member');
    const adminToken = await addMember(acme.workspace.id, 'admin@acme.example', 'admin');

    expect((await startConnect(memberToken)).res.status).toBe(403);
    expect((await startConnect(adminToken)).res.status).toBe(200);
  });

  it('returns a Facebook Login for Business URL and never exposes a secret', async () => {
    const { res, state } = await startConnect(acme.token);
    const url = new URL(res.body.authorizationUrl);

    expect(res.status).toBe(200);
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v25.0/dialog/oauth');
    expect(url.searchParams.get('config_id')).toBe(env.meta.loginConfigId);
    expect(url.searchParams.get('client_id')).toBe(env.meta.appId);
    expect(url.searchParams.get('redirect_uri')).toBe(env.meta.redirectUri);
    expect(url.searchParams.has('scope')).toBe(false);
    expect(state.length).toBeGreaterThanOrEqual(43);
    expect(res.text).not.toContain(env.meta.appSecret);
  });

  it('ties the attempt to the browser with an httpOnly cookie scoped to the callback', async () => {
    const { res, state, cookie } = await startConnect(acme.token);
    const setCookie = res.headers['set-cookie'].find((c) => c.startsWith('ls_oauth_state='));

    expect(cookie).toBe(state);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/api/v1/facebook/oauth');
  });

  it('stores only a hash of the state, scoped to the workspace and user', async () => {
    const { state } = await startConnect(acme.token);
    const record = await OAuthState.findOne().unscoped();

    expect(record.stateHash).not.toBe(state);
    expect(record.stateHash).toHaveLength(64);
    expect(String(record.workspaceId)).toBe(acme.workspace.id);
    expect(String(record.userId)).toBe(acme.user.id);
  });

  it('issues a different state every time', async () => {
    const first = await startConnect(acme.token);
    const second = await startConnect(acme.token);

    expect(first.state).not.toBe(second.state);
  });
});

describe('GET /facebook/oauth/callback', () => {
  it('connects the account, stores the token encrypted and redirects without secrets', async () => {
    const { calls } = mockGraph(graphRoutes());

    const res = await completeLogin(acme);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(SUCCESS_URL);
    expect(res.headers.location).not.toMatch(/token|code=|secret/i);
    expect(res.headers['set-cookie'].join(';')).toContain('ls_oauth_state=;');

    const connection = await storedConnection(acme.workspace.id);
    expect(connection).toMatchObject({
      facebookUserId: FB_USER,
      name: 'Fiona Business',
      status: 'active',
      statusReason: null,
    });
    expect(String(connection.connectedBy)).toBe(acme.user.id);
    expect(connection.grantedScopes).toEqual(expect.arrayContaining(REQUIRED_SCOPES));
    expect(connection.dataAccessExpiresAt).toBeInstanceOf(Date);

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /oauth/access_token',
      'GET /oauth/access_token',
      'GET /debug_token',
      'GET /me',
    ]);
    expect(calls[0].params.code).toBe('AUTH_CODE');
    expect(calls[1].params.fb_exchange_token).toBe('SHORT_TOKEN');
  });

  it('stores the long-lived token encrypted and bound to its workspace and Facebook user', async () => {
    mockGraph(graphRoutes());
    await completeLogin(acme);

    const connection = await storedConnection(acme.workspace.id);
    const aad = tokenAad(acme.workspace.id, FB_USER);

    expect(connection.userTokenCipher).not.toContain('LONG_TOKEN');
    expect(connection.userTokenCipher.startsWith('v1.')).toBe(true);
    expect(tokenCrypto.decrypt(connection.userTokenCipher, aad)).toBe('LONG_TOKEN');
    expect(() =>
      tokenCrypto.decrypt(connection.userTokenCipher, tokenAad(globex.workspace.id, FB_USER)),
    ).toThrow();
  });

  it('consumes the state, so replaying the callback fails without calling Facebook', async () => {
    const { calls } = mockGraph(graphRoutes());
    const flow = await startConnect(acme.token);

    const first = await callback({ state: flow.state, cookie: flow.cookie, code: 'AUTH_CODE' });
    const callsAfterFirst = calls.length;
    const replay = await callback({ state: flow.state, cookie: flow.cookie, code: 'AUTH_CODE' });

    expect(first.headers.location).toBe(SUCCESS_URL);
    expect(replay.headers.location).toBe(errorUrl('state'));
    expect(calls).toHaveLength(callsAfterFirst);
    expect(await OAuthState.countDocuments().unscoped()).toBe(0);
  });

  it('rejects a callback with no state cookie, before touching Facebook or the state', async () => {
    const { calls } = mockGraph(graphRoutes());
    const flow = await startConnect(acme.token);

    const res = await callback({ state: flow.state, code: 'AUTH_CODE' });

    expect(res.headers.location).toBe(errorUrl('state'));
    expect(calls).toHaveLength(0);
    expect(await OAuthState.countDocuments().unscoped()).toBe(1);
  });

  it('rejects a flow finished in a different browser than the one that started it', async () => {
    const { calls } = mockGraph(graphRoutes());
    const attackerFlow = await startConnect(acme.token);
    const victimFlow = await startConnect(globex.token);

    // The victim's browser holds the victim's cookie but follows the attacker's state.
    const res = await callback({
      state: attackerFlow.state,
      cookie: victimFlow.cookie,
      code: 'VICTIM_CODE',
    });

    expect(res.headers.location).toBe(errorUrl('state'));
    expect(calls).toHaveLength(0);
    expect(await countAllConnections()).toBe(0);
  });

  it('rejects an unknown state even when the cookie matches', async () => {
    const { calls } = mockGraph(graphRoutes());

    const res = await callback({ state: 'forged-state', cookie: 'forged-state', code: 'C' });

    expect(res.headers.location).toBe(errorUrl('state'));
    expect(calls).toHaveLength(0);
  });

  it('rejects an expired state', async () => {
    const { calls } = mockGraph(graphRoutes());
    const flow = await startConnect(acme.token);
    await OAuthState.updateOne({}, { createdAt: new Date(Date.now() - 11 * 60 * 1000) }).unscoped();

    const res = await callback({ state: flow.state, cookie: flow.cookie, code: 'C' });

    expect(res.headers.location).toBe(errorUrl('state'));
    expect(calls).toHaveLength(0);
    expect(await countAllConnections()).toBe(0);
  });

  it('does not crash on repeated or malformed query parameters', async () => {
    mockGraph(graphRoutes());

    const res = await request(app)
      .get(`${API}/facebook/oauth/callback?state=a&state=b&code[]=x`)
      .set('Cookie', 'ls_oauth_state=a');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(errorUrl('state'));
  });

  it('reports a denied login and consumes the state', async () => {
    const { calls } = mockGraph(graphRoutes());
    const flow = await startConnect(acme.token);

    const res = await callback({
      state: flow.state,
      cookie: flow.cookie,
      error: 'access_denied',
      error_reason: 'user_denied',
    });

    expect(res.headers.location).toBe(errorUrl('denied'));
    expect(calls).toHaveLength(0);
    expect(await OAuthState.countDocuments().unscoped()).toBe(0);
    expect(await countAllConnections()).toBe(0);
  });

  it('fails cleanly when no code is returned', async () => {
    mockGraph(graphRoutes());
    const flow = await startConnect(acme.token);

    const res = await callback({ state: flow.state, cookie: flow.cookie });

    expect(res.headers.location).toBe(errorUrl('exchange'));
  });

  it('fails cleanly when Facebook rejects the code', async () => {
    mockGraph(
      graphRoutes({
        'GET /oauth/access_token': graphError(400, {
          code: 100,
          message: 'Invalid verification code',
        }),
      }),
    );

    const res = await completeLogin(acme);

    expect(res.headers.location).toBe(errorUrl('exchange'));
    expect(res.headers.location).not.toContain('Invalid');
    expect(await countAllConnections()).toBe(0);
  });

  it('reports when Facebook cannot be reached', async () => {
    mockGraph({});
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network down');
    });

    const res = await completeLogin(acme);

    expect(res.headers.location).toBe(errorUrl('unavailable'));
    expect(await countAllConnections()).toBe(0);
  });

  it('refuses a token that belongs to a different Facebook app', async () => {
    mockGraph(graphRoutes({ 'GET /debug_token': reply({ data: tokenInfo({ app_id: '999' }) }) }));

    const res = await completeLogin(acme);

    expect(res.headers.location).toBe(errorUrl('exchange'));
    expect(await countAllConnections()).toBe(0);
  });

  it('refuses a token Facebook reports as invalid', async () => {
    mockGraph(graphRoutes({ 'GET /debug_token': reply({ data: tokenInfo({ is_valid: false }) }) }));

    const res = await completeLogin(acme);

    expect(res.headers.location).toBe(errorUrl('exchange'));
    expect(await countAllConnections()).toBe(0);
  });

  it('still connects when the profile lookup fails', async () => {
    mockGraph(graphRoutes({ 'GET /me': graphError(500, { code: 2 }) }));

    const res = await completeLogin(acme);

    expect(res.headers.location).toBe(SUCCESS_URL);
    expect((await storedConnection(acme.workspace.id)).name).toBeUndefined();
  });

  it('records missing permissions instead of assuming the login granted lead access', async () => {
    const granted = ['public_profile', 'pages_show_list', 'pages_read_engagement'];
    mockGraph(graphRoutes({ 'GET /debug_token': reply({ data: tokenInfo({ scopes: granted }) }) }));

    await completeLogin(acme);
    const res = await request(app).get(`${API}/facebook/connections`).set(bearer(acme.token));

    expect(res.body.connections[0].missingScopes).toEqual([
      'pages_manage_metadata',
      'pages_manage_ads',
      'leads_retrieval',
    ]);
  });

  it('keeps a single connection per workspace and Facebook account when reconnecting', async () => {
    mockGraph(graphRoutes());
    await completeLogin(acme);
    await FacebookConnection.inWorkspace(acme.workspace.id).updateOne(
      { facebookUserId: FB_USER },
      { status: 'expired', statusReason: 'Session has expired', $unset: { userTokenCipher: '' } },
    );

    await completeLogin(acme);

    const all = await FacebookConnection.inWorkspace(acme.workspace.id).find();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('active');
    expect(all[0].statusReason).toBeNull();
    expect((await storedConnection(acme.workspace.id)).userTokenCipher).toBeTruthy();
  });

  it('stores the connection in the workspace that started the flow, never another', async () => {
    mockGraph(graphRoutes());
    await completeLogin(acme);

    expect(await FacebookConnection.inWorkspace(acme.workspace.id).countDocuments()).toBe(1);
    expect(await FacebookConnection.inWorkspace(globex.workspace.id).countDocuments()).toBe(0);
  });
});

describe('GET /facebook/connections', () => {
  it('requires authentication', async () => {
    expect((await request(app).get(`${API}/facebook/connections`)).status).toBe(401);
  });

  it('lists the workspace’s connections without any secret, for any member', async () => {
    mockGraph(graphRoutes());
    await completeLogin(acme);
    const memberToken = await addMember(acme.workspace.id, 'member@acme.example', 'member');

    const res = await request(app).get(`${API}/facebook/connections`).set(bearer(memberToken));

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.requiredScopes).toEqual(REQUIRED_SCOPES);
    expect(res.body.connections).toHaveLength(1);
    expect(res.body.connections[0]).toMatchObject({
      facebookUserId: FB_USER,
      name: 'Fiona Business',
      status: 'active',
      missingScopes: [],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/LONG_TOKEN|SHORT_TOKEN|userTokenCipher|v1\./);
  });

  it('never shows another workspace’s connections', async () => {
    mockGraph(graphRoutes());
    await completeLogin(acme);

    const res = await request(app).get(`${API}/facebook/connections`).set(bearer(globex.token));

    expect(res.body.connections).toEqual([]);
  });
});

describe('POST /facebook/connections/:id/check', () => {
  let connectionId;
  const check = (token, id = connectionId) =>
    request(app).post(`${API}/facebook/connections/${id}/check`).set(bearer(token));

  beforeEach(async () => {
    mockGraph(graphRoutes());
    await completeLogin(acme);
    connectionId = String((await storedConnection(acme.workspace.id))._id);
  });

  it('refreshes granted permissions and expiry from Facebook', async () => {
    mockGraph(
      graphRoutes({
        'GET /debug_token': reply({ data: tokenInfo({ scopes: ['pages_show_list'] }) }),
      }),
    );

    const res = await check(acme.token);

    expect(res.status).toBe(200);
    expect(res.body.connection.status).toBe('active');
    expect(res.body.connection.grantedScopes).toEqual(['pages_show_list']);
    expect(res.body.connection.missingScopes).toContain('leads_retrieval');
  });

  it('marks an expired token as expired and discards it', async () => {
    mockGraph(
      graphRoutes({
        'GET /debug_token': reply({
          data: {
            is_valid: false,
            error: { code: 190, subcode: 463, message: 'Session has expired' },
          },
        }),
      }),
    );

    const res = await check(acme.token);

    expect(res.body.connection).toMatchObject({
      status: 'expired',
      statusReason: 'Session has expired',
    });
    expect((await storedConnection(acme.workspace.id)).userTokenCipher).toBeUndefined();
  });

  it('marks a token whose user removed the app as revoked', async () => {
    mockGraph(
      graphRoutes({
        'GET /debug_token': reply({
          data: {
            is_valid: false,
            error: { code: 190, subcode: 458, message: 'App not authorized' },
          },
        }),
      }),
    );

    expect((await check(acme.token)).body.connection.status).toBe('revoked');
  });

  it('marks a token that belongs to someone else as an error', async () => {
    mockGraph(
      graphRoutes({ 'GET /debug_token': reply({ data: tokenInfo({ user_id: OTHER_FB_USER }) }) }),
    );

    expect((await check(acme.token)).body.connection.status).toBe('error');
  });

  it('marks a connection whose data access lapsed as expired', async () => {
    mockGraph(
      graphRoutes({
        'GET /debug_token': reply({ data: tokenInfo({ data_access_expires_at: inDays(-1) }) }),
      }),
    );

    const { connection } = (await check(acme.token)).body;

    expect(connection.status).toBe('expired');
    expect(connection.statusReason).toMatch(/data access/i);
  });

  it('leaves the connection untouched when Facebook is unavailable', async () => {
    mockGraph(graphRoutes({ 'GET /debug_token': graphError(500, { code: 2 }) }));

    const res = await check(acme.token);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('FACEBOOK_ERROR');
    expect((await storedConnection(acme.workspace.id)).status).toBe('active');
  });

  it('reports Facebook rate limiting as 429', async () => {
    mockGraph(graphRoutes({ 'GET /debug_token': graphError(400, { code: 4 }) }));

    const res = await check(acme.token);

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('FACEBOOK_RATE_LIMITED');
  });

  it('does not call Facebook for a connection that has no token left', async () => {
    await FacebookConnection.inWorkspace(acme.workspace.id).updateOne(
      { _id: connectionId },
      { status: 'revoked', $unset: { userTokenCipher: '' } },
    );
    const { calls } = mockGraph(graphRoutes());

    const res = await check(acme.token);

    expect(res.body.connection.status).toBe('revoked');
    expect(calls).toHaveLength(0);
  });

  it('is limited to owners and admins', async () => {
    const memberToken = await addMember(acme.workspace.id, 'member@acme.example', 'member');

    expect((await check(memberToken)).status).toBe(403);
  });

  it.each([
    ['another workspace’s connection', () => connectionId, () => globex.token],
    ['an unknown id', () => '64b7f0c2a1b2c3d4e5f60718', () => acme.token],
    ['a malformed id', () => 'not-an-id', () => acme.token],
  ])('returns 404 for %s', async (_label, id, token) => {
    expect((await check(token(), id())).status).toBe(404);
  });
});

describe('DELETE /facebook/connections/:id', () => {
  let connectionId;
  const disconnect = (token, id = connectionId) =>
    request(app).delete(`${API}/facebook/connections/${id}`).set(bearer(token));

  beforeEach(async () => {
    mockGraph(graphRoutes());
    await completeLogin(acme);
    connectionId = String((await storedConnection(acme.workspace.id))._id);
  });

  it('removes the connection and revokes the permissions on Facebook', async () => {
    const { calls } = mockGraph(graphRoutes());

    const res = await disconnect(acme.token);

    expect(res.status).toBe(204);
    expect(await storedConnection(acme.workspace.id)).toBeNull();

    const revoke = calls.find((c) => c.method === 'DELETE');
    expect(revoke.path).toBe(`/${FB_USER}/permissions`);
    expect(revoke.params.access_token).toBe('LONG_TOKEN');
    expect(revoke.params.appsecret_proof).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps Facebook access alive when another workspace uses the same Facebook account', async () => {
    mockGraph(graphRoutes());
    await completeLogin(globex);
    const { calls } = mockGraph(graphRoutes());

    const res = await disconnect(acme.token);

    expect(res.status).toBe(204);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    const remaining = await storedConnection(globex.workspace.id);
    expect(remaining.userTokenCipher).toBeTruthy();
  });

  it('still disconnects when Facebook refuses the revocation', async () => {
    mockGraph(graphRoutes({ [`DELETE /${FB_USER}/permissions`]: graphError(400, { code: 190 }) }));

    const res = await disconnect(acme.token);

    expect(res.status).toBe(204);
    expect(await storedConnection(acme.workspace.id)).toBeNull();
  });

  it('does not call Facebook for a connection that already lost its token', async () => {
    await FacebookConnection.inWorkspace(acme.workspace.id).updateOne(
      { _id: connectionId },
      { status: 'expired', $unset: { userTokenCipher: '' } },
    );
    const { calls } = mockGraph(graphRoutes());

    expect((await disconnect(acme.token)).status).toBe(204);
    expect(calls).toHaveLength(0);
  });

  it('is limited to owners and admins', async () => {
    const memberToken = await addMember(acme.workspace.id, 'member@acme.example', 'member');

    expect((await disconnect(memberToken)).status).toBe(403);
    expect(await storedConnection(acme.workspace.id)).not.toBeNull();
  });

  it('cannot remove another workspace’s connection', async () => {
    expect((await disconnect(globex.token)).status).toBe(404);
    expect(await storedConnection(acme.workspace.id)).not.toBeNull();
  });
});

describe('POST /facebook/deauthorize', () => {
  const send = (signed) =>
    request(app).post(`${API}/facebook/deauthorize`).type('form').send({ signed_request: signed });
  const payload = (overrides = {}) => ({
    algorithm: 'HMAC-SHA256',
    issued_at: Math.floor(Date.now() / 1000),
    user_id: FB_USER,
    ...overrides,
  });

  it('revokes the Facebook account in every workspace that connected it', async () => {
    mockGraph(graphRoutes());
    await completeLogin(acme);
    await completeLogin(globex);
    mockGraph(
      graphRoutes({
        'GET /debug_token': reply({ data: tokenInfo({ user_id: OTHER_FB_USER }) }),
        'GET /me': reply({ id: OTHER_FB_USER, name: 'Someone Else' }),
      }),
    );
    await completeLogin(acme);

    const res = await send(signedRequest(payload(), env.meta.appSecret));

    expect(res.status).toBe(200);
    for (const workspace of [acme.workspace, globex.workspace]) {
      const connection = await storedConnection(workspace.id);
      expect(connection.status).toBe('revoked');
      expect(connection.userTokenCipher).toBeUndefined();
    }
    const unaffected = await storedConnection(acme.workspace.id, OTHER_FB_USER);
    expect(unaffected.status).toBe('active');
    expect(unaffected.userTokenCipher).toBeTruthy();
  });

  it.each([
    ['a bad signature', () => signedRequest(payload(), 'not-the-app-secret')],
    [
      'an unsupported algorithm',
      () => signedRequest(payload({ algorithm: 'HS512' }), env.meta.appSecret),
    ],
    [
      'a non-numeric user id',
      () => signedRequest(payload({ user_id: '1; drop' }), env.meta.appSecret),
    ],
    ['a missing user id', () => signedRequest(payload({ user_id: undefined }), env.meta.appSecret)],
    ['garbage', () => 'garbage'],
  ])('rejects %s and changes nothing', async (_label, build) => {
    mockGraph(graphRoutes());
    await completeLogin(acme);

    const res = await send(build());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SIGNED_REQUEST');
    expect((await storedConnection(acme.workspace.id)).status).toBe('active');
  });

  it('rejects a request with no signed_request', async () => {
    const res = await request(app).post(`${API}/facebook/deauthorize`).type('form').send({});

    expect(res.status).toBe(400);
  });
});

describe('requireFacebookConfigured', () => {
  it('blocks the request with a 503 when Facebook is not configured', () => {
    const next = vi.fn();

    requireFacebookConfigured(() => null)({}, {}, next);

    const [error] = next.mock.calls[0];
    expect(error).toMatchObject({ statusCode: 503, code: 'FACEBOOK_NOT_CONFIGURED' });
  });

  it('lets the request through when it is configured', () => {
    const next = vi.fn();

    requireFacebookConfigured(() => ({}))({}, {}, next);

    expect(next).toHaveBeenCalledWith();
  });
});
