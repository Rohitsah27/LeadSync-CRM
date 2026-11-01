import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { FacebookConnection } from '../models/FacebookConnection.js';
import { FacebookPage } from '../models/FacebookPage.js';
import { pageTokenAad } from '../services/facebookPage.service.js';
import { tokenCrypto } from '../services/tokenCrypto.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db.js';
import {
  API,
  bearer,
  createFlow,
  FB_USER,
  graphRoutes,
  pageRoutes,
  pageTokenInfo,
  tokenInfo,
} from './helpers/facebookFlow.js';
import { graphError, mockGraph, reply, signedRequest } from './helpers/graphMock.js';
import { env } from '../config/env.js';

const app = createApp();
const { signUp, addMember, completeLogin } = createFlow(app);

const routes = (overrides = {}) => graphRoutes(pageRoutes(overrides));
const deadUserToken = () =>
  reply({
    data: tokenInfo({
      is_valid: false,
      error: { code: 190, subcode: 463, message: 'Session has expired' },
    }),
  });

let acme;
let globex;

/** Connects an account's Facebook, then returns the new connection's id. */
async function connectFacebook(account) {
  mockGraph(routes());
  await completeLogin(account);
  const connection = await FacebookConnection.inWorkspace(account.workspace.id).findOne();
  return String(connection._id);
}

const available = (token, connectionId) =>
  request(app).get(`${API}/facebook/connections/${connectionId}/pages`).set(bearer(token));
const connectPage = (token, body) =>
  request(app).post(`${API}/facebook/pages`).set(bearer(token)).send(body);
const check = (token, pageId) =>
  request(app).post(`${API}/facebook/pages/${pageId}/check`).set(bearer(token));
const disconnect = (token, pageId) =>
  request(app).delete(`${API}/facebook/pages/${pageId}`).set(bearer(token));
const listConnected = (token) => request(app).get(`${API}/facebook/pages`).set(bearer(token));
const storedPage = (workspaceId, pageId) =>
  FacebookPage.inWorkspace(workspaceId).findOne({ pageId }).select('+pageTokenCipher');

let acmeConnection;
let globexConnection;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(() => {
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  await clearTestDb();
  acme = await signUp('owner@acme.example', 'Acme Realty');
  globex = await signUp('owner@globex.example', 'Globex Autos');
  acmeConnection = await connectFacebook(acme);
  globexConnection = await connectFacebook(globex);
});

describe('GET /facebook/connections/:id/pages', () => {
  it('requires an admin', async () => {
    const memberToken = await addMember(acme.workspace.id, 'member@acme.example', 'member');
    mockGraph(routes());

    expect(
      (await request(app).get(`${API}/facebook/connections/${acmeConnection}/pages`)).status,
    ).toBe(401);
    expect((await available(memberToken, acmeConnection)).status).toBe(403);
  });

  it('lists every Page Facebook says the account manages, across result pages', async () => {
    const { calls } = mockGraph(routes());

    const res = await available(acme.token, acmeConnection);

    expect(res.status).toBe(200);
    expect(res.body.pages.map((page) => page.pageId)).toEqual(['111', '222', '333']);
    expect(res.body.pages[0]).toMatchObject({
      name: 'Acme Realty',
      category: 'Real Estate',
      pictureUrl: 'https://cdn.example/111.jpg',
      tasks: ['ADVERTISE', 'MANAGE'],
      canRetrieveLeads: true,
      connected: false,
      inUseElsewhere: false,
    });
    expect(res.body.pages[1].canRetrieveLeads).toBe(false);

    const accountCalls = calls.filter((call) => call.path === '/me/accounts');
    expect(accountCalls).toHaveLength(2);
    expect(accountCalls[1].params.after).toBe('CURSOR1');
  });

  it('never exposes a token', async () => {
    mockGraph(routes());

    const res = await available(acme.token, acmeConnection);

    expect(JSON.stringify(res.body)).not.toMatch(/PAGE_TOKEN|LONG_TOKEN|access_token/);
  });

  it('marks Pages the workspace already connected', async () => {
    mockGraph(routes());
    await connectPage(acme.token, { connectionId: acmeConnection, pageId: '222' });

    const res = await available(acme.token, acmeConnection);

    expect(res.body.pages.find((page) => page.pageId === '222').connected).toBe(true);
    expect(res.body.pages.find((page) => page.pageId === '111').connected).toBe(false);
  });

  it('says a Page is taken by another workspace without saying who', async () => {
    mockGraph(routes());
    await connectPage(globex.token, { connectionId: globexConnection, pageId: '111' });

    const res = await available(acme.token, acmeConnection);

    const page = res.body.pages.find((candidate) => candidate.pageId === '111');
    expect(page).toMatchObject({ connected: false, inUseElsewhere: true });
    expect(JSON.stringify(res.body)).not.toMatch(/globex/i);
  });

  it('does not treat another workspace’s dead claim as taken', async () => {
    mockGraph(routes());
    await connectPage(globex.token, { connectionId: globexConnection, pageId: '111' });
    await FacebookPage.inWorkspace(globex.workspace.id).updateOne(
      { pageId: '111' },
      { status: 'invalid', $unset: { pageTokenCipher: '' } },
    );

    const res = await available(acme.token, acmeConnection);

    expect(res.body.pages.find((page) => page.pageId === '111').inUseElsewhere).toBe(false);
  });

  it.each([
    ['another workspace’s connection', () => globexConnection],
    ['an unknown connection', () => '64b7f0c2a1b2c3d4e5f60718'],
    ['a malformed id', () => 'nope'],
  ])('returns 404 for %s', async (_label, id) => {
    const { calls } = mockGraph(routes());

    expect((await available(acme.token, id())).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('refuses a connection that needs reconnecting, without calling Facebook', async () => {
    await FacebookConnection.inWorkspace(acme.workspace.id).updateOne(
      { _id: acmeConnection },
      { status: 'expired', $unset: { userTokenCipher: '' } },
    );
    const { calls } = mockGraph(routes());

    const res = await available(acme.token, acmeConnection);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONNECTION_NOT_ACTIVE');
    expect(calls).toHaveLength(0);
  });

  it('records a dead token when Facebook rejects it', async () => {
    mockGraph(
      routes({
        'GET /me/accounts': graphError(400, { code: 190, error_subcode: 463 }),
        'GET /debug_token': deadUserToken(),
      }),
    );

    const res = await available(acme.token, acmeConnection);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONNECTION_NOT_ACTIVE');
    const connection = await FacebookConnection.inWorkspace(acme.workspace.id).findById(
      acmeConnection,
    );
    expect(connection.status).toBe('expired');
  });

  it('reports Facebook being unavailable or rate limiting', async () => {
    mockGraph(routes({ 'GET /me/accounts': graphError(500, { code: 2 }) }));
    const unavailable = await available(acme.token, acmeConnection);

    mockGraph(routes({ 'GET /me/accounts': graphError(400, { code: 4 }) }));
    const limited = await available(acme.token, acmeConnection);

    expect(unavailable.status).toBe(502);
    expect(unavailable.body.error.code).toBe('FACEBOOK_ERROR');
    expect(limited.status).toBe(429);
  });
});

describe('POST /facebook/pages', () => {
  const connectAcme = (pageId = '111') =>
    connectPage(acme.token, { connectionId: acmeConnection, pageId });

  beforeEach(() => {
    mockGraph(routes());
  });

  it('connects a Page and stores its token encrypted', async () => {
    const res = await connectAcme();

    expect(res.status).toBe(201);
    expect(res.body.page).toMatchObject({
      pageId: '111',
      name: 'Acme Realty',
      category: 'Real Estate',
      pictureUrl: 'https://cdn.example/111.jpg',
      tasks: ['ADVERTISE', 'MANAGE'],
      status: 'active',
      connectionId: acmeConnection,
      connectedBy: acme.user.id,
      tokenExpiresAt: null,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/PAGE_TOKEN|pageTokenCipher/);

    const stored = await storedPage(acme.workspace.id, '111');
    expect(stored.pageTokenCipher).not.toContain('PAGE_TOKEN_111');
    expect(
      tokenCrypto.decrypt(stored.pageTokenCipher, pageTokenAad(acme.workspace.id, '111')),
    ).toBe('PAGE_TOKEN_111');
    expect(() =>
      tokenCrypto.decrypt(stored.pageTokenCipher, pageTokenAad(globex.workspace.id, '111')),
    ).toThrow();
  });

  it('is limited to admins', async () => {
    const memberToken = await addMember(acme.workspace.id, 'member@acme.example', 'member');

    expect((await request(app).post(`${API}/facebook/pages`).send({})).status).toBe(401);
    expect(
      (await connectPage(memberToken, { connectionId: acmeConnection, pageId: '111' })).status,
    ).toBe(403);
    expect(await FacebookPage.inWorkspace(acme.workspace.id).countDocuments()).toBe(0);
  });

  it.each([
    ['no body', {}],
    ['a malformed connection id', { connectionId: 'nope', pageId: '111' }],
    ['a non-numeric Page id', { connectionId: 'a'.repeat(24), pageId: '1; drop' }],
    ['a numeric (not string) Page id', { connectionId: 'a'.repeat(24), pageId: 111 }],
  ])('rejects %s', async (_label, body) => {
    const res = await connectPage(acme.token, body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a Page the Facebook account does not manage', async () => {
    const res = await connectAcme('999');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PAGE_NOT_FOUND');
    expect(await FacebookPage.inWorkspace(acme.workspace.id).countDocuments()).toBe(0);
  });

  it('refuses a Page when Facebook gives no access token for it', async () => {
    mockGraph(
      routes({
        'GET /me/accounts': reply({ data: [{ ...PAGES_WITHOUT_TOKEN }] }),
      }),
    );

    const res = await connectAcme('111');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAGE_TOKEN_UNAVAILABLE');
  });

  it.each([
    ['one Facebook reports as invalid', () => pageTokenInfo({ is_valid: false })],
    ['one issued to a different app', () => pageTokenInfo({ app_id: '999' })],
  ])('refuses %s', async (_label, info) => {
    mockGraph(
      routes({
        'GET /debug_token': ({ params }) =>
          reply({ data: params.input_token.startsWith('PAGE_TOKEN') ? info() : tokenInfo() }),
      }),
    );

    const res = await connectAcme();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAGE_TOKEN_INVALID');
    expect(await FacebookPage.inWorkspace(acme.workspace.id).countDocuments()).toBe(0);
  });

  it('refuses a Page another workspace is using, leaving that workspace untouched', async () => {
    await connectPage(globex.token, { connectionId: globexConnection, pageId: '111' });

    const res = await connectAcme('111');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAGE_IN_USE');
    expect(await FacebookPage.inWorkspace(acme.workspace.id).countDocuments()).toBe(0);
    const theirs = await storedPage(globex.workspace.id, '111');
    expect(theirs.status).toBe('active');
    expect(theirs.pageTokenCipher).toBeTruthy();
  });

  it('lets a workspace take over a Page whose previous claim is dead', async () => {
    await connectPage(globex.token, { connectionId: globexConnection, pageId: '111' });
    await FacebookPage.inWorkspace(globex.workspace.id).updateOne(
      { pageId: '111' },
      { status: 'invalid', $unset: { pageTokenCipher: '' } },
    );

    const res = await connectAcme('111');

    expect(res.status).toBe(201);
    expect(await FacebookPage.inWorkspace(globex.workspace.id).countDocuments()).toBe(0);
    expect(await FacebookPage.inWorkspace(acme.workspace.id).countDocuments()).toBe(1);
  });

  it('is idempotent, refreshing the existing record', async () => {
    await connectAcme('111');
    await FacebookPage.inWorkspace(acme.workspace.id).updateOne(
      { pageId: '111' },
      { name: 'Stale' },
    );

    const again = await connectAcme('111');

    expect(again.status).toBe(201);
    expect(again.body.page.name).toBe('Acme Realty');
    expect(await FacebookPage.inWorkspace(acme.workspace.id).countDocuments()).toBe(1);
  });

  it('gives a Page to only one workspace when two connect it at the same moment', async () => {
    const results = await Promise.all([
      connectAcme('333'),
      connectPage(globex.token, { connectionId: globexConnection, pageId: '333' }),
    ]);

    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await FacebookPage.countDocuments({ pageId: '333' }).unscoped()).toBe(1);
  });

  it('cannot use another workspace’s Facebook connection', async () => {
    const res = await connectPage(acme.token, { connectionId: globexConnection, pageId: '111' });

    expect(res.status).toBe(404);
    expect(await FacebookPage.countDocuments().unscoped()).toBe(0);
  });

  it('needs a connection that is still usable', async () => {
    await FacebookConnection.inWorkspace(acme.workspace.id).updateOne(
      { _id: acmeConnection },
      { status: 'revoked', $unset: { userTokenCipher: '' } },
    );

    const res = await connectAcme();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONNECTION_NOT_ACTIVE');
  });

  it('reports Facebook failing while connecting', async () => {
    mockGraph(routes({ 'GET /me/accounts': graphError(500, { code: 2 }) }));

    expect((await connectAcme()).status).toBe(502);
  });
});

describe('GET /facebook/pages', () => {
  it('lists the workspace’s connected Pages for any member, without secrets', async () => {
    mockGraph(routes());
    await connectPage(acme.token, { connectionId: acmeConnection, pageId: '111' });
    await connectPage(acme.token, { connectionId: acmeConnection, pageId: '222' });
    await connectPage(globex.token, { connectionId: globexConnection, pageId: '333' });
    const memberToken = await addMember(acme.workspace.id, 'member@acme.example', 'member');

    const res = await listConnected(memberToken);

    expect(res.status).toBe(200);
    expect(res.body.pages.map((page) => page.pageId)).toEqual(['111', '222']);
    expect(JSON.stringify(res.body)).not.toMatch(/PAGE_TOKEN|pageTokenCipher/);
  });

  it('requires authentication', async () => {
    expect((await request(app).get(`${API}/facebook/pages`)).status).toBe(401);
  });

  it('is empty for a workspace with no Pages', async () => {
    expect((await listConnected(globex.token)).body.pages).toEqual([]);
  });
});

describe('POST /facebook/pages/:pageId/check', () => {
  beforeEach(async () => {
    mockGraph(routes());
    await connectPage(acme.token, { connectionId: acmeConnection, pageId: '111' });
  });

  it('confirms the token and refreshes the Page’s name and picture', async () => {
    await FacebookPage.inWorkspace(acme.workspace.id).updateOne(
      { pageId: '111' },
      { name: 'Old name', pictureUrl: 'https://cdn.example/old.jpg' },
    );
    mockGraph(
      routes({
        'GET /111': reply({
          id: '111',
          name: 'Acme Realty Group',
          category: 'Real Estate',
          picture: { data: { url: 'https://cdn.example/new.jpg' } },
        }),
      }),
    );

    const res = await check(acme.token, '111');

    expect(res.status).toBe(200);
    expect(res.body.page).toMatchObject({
      status: 'active',
      name: 'Acme Realty Group',
      pictureUrl: 'https://cdn.example/new.jpg',
    });
  });

  it('still succeeds when the details cannot be fetched', async () => {
    mockGraph(routes({ 'GET /111': graphError(500, { code: 2 }) }));

    const res = await check(acme.token, '111');

    expect(res.status).toBe(200);
    expect(res.body.page).toMatchObject({ status: 'active', name: 'Acme Realty' });
  });

  it('marks a Page invalid and discards its token when Facebook rejects it', async () => {
    mockGraph(
      routes({
        'GET /debug_token': ({ params }) =>
          reply({
            data: params.input_token.startsWith('PAGE_TOKEN')
              ? pageTokenInfo({ is_valid: false, error: { code: 190, message: 'Token revoked' } })
              : tokenInfo(),
          }),
      }),
    );

    const res = await check(acme.token, '111');

    expect(res.body.page).toMatchObject({ status: 'invalid', statusReason: 'Token revoked' });
    expect((await storedPage(acme.workspace.id, '111')).pageTokenCipher).toBeUndefined();
  });

  it('marks a Page invalid without calling Facebook when its connection is gone', async () => {
    await FacebookConnection.inWorkspace(acme.workspace.id).updateOne(
      { _id: acmeConnection },
      { status: 'expired', $unset: { userTokenCipher: '' } },
    );
    const { calls } = mockGraph(routes());

    const res = await check(acme.token, '111');

    expect(res.body.page.status).toBe('invalid');
    expect(res.body.page.statusReason).toMatch(/reconnected/);
    expect(calls).toHaveLength(0);
  });

  it('does not call Facebook for a Page that already lost its token', async () => {
    await FacebookPage.inWorkspace(acme.workspace.id).updateOne(
      { pageId: '111' },
      { status: 'invalid', $unset: { pageTokenCipher: '' } },
    );
    const { calls } = mockGraph(routes());

    const res = await check(acme.token, '111');

    expect(res.body.page.status).toBe('invalid');
    expect(calls).toHaveLength(0);
  });

  it('leaves the Page untouched when Facebook is unavailable', async () => {
    mockGraph(routes({ 'GET /debug_token': graphError(500, { code: 2 }) }));

    const res = await check(acme.token, '111');

    expect(res.status).toBe(502);
    expect((await storedPage(acme.workspace.id, '111')).status).toBe('active');
  });

  it('is limited to admins and to the workspace’s own Pages', async () => {
    const memberToken = await addMember(acme.workspace.id, 'member@acme.example', 'member');

    expect((await check(memberToken, '111')).status).toBe(403);
    expect((await check(globex.token, '111')).status).toBe(404);
    expect((await check(acme.token, '999')).status).toBe(404);
    expect((await check(acme.token, 'abc')).status).toBe(404);
  });
});

describe('DELETE /facebook/pages/:pageId', () => {
  beforeEach(async () => {
    mockGraph(routes());
    await connectPage(acme.token, { connectionId: acmeConnection, pageId: '111' });
  });

  it('disconnects the Page and deletes its token', async () => {
    const res = await disconnect(acme.token, '111');

    expect(res.status).toBe(204);
    expect(await storedPage(acme.workspace.id, '111')).toBeNull();
  });

  it('frees the Page for another workspace to connect', async () => {
    await disconnect(acme.token, '111');

    const res = await connectPage(globex.token, { connectionId: globexConnection, pageId: '111' });

    expect(res.status).toBe(201);
  });

  it('is limited to admins and cannot reach another workspace’s Page', async () => {
    const memberToken = await addMember(acme.workspace.id, 'member@acme.example', 'member');

    expect((await disconnect(memberToken, '111')).status).toBe(403);
    expect((await disconnect(globex.token, '111')).status).toBe(404);
    expect(await storedPage(acme.workspace.id, '111')).not.toBeNull();
  });

  it('returns 404 for an unknown or malformed Page id', async () => {
    expect((await disconnect(acme.token, '999')).status).toBe(404);
    expect((await disconnect(acme.token, 'x')).status).toBe(404);
  });
});

describe('Pages and their Facebook connection', () => {
  beforeEach(async () => {
    mockGraph(routes());
    await connectPage(acme.token, { connectionId: acmeConnection, pageId: '111' });
    await connectPage(acme.token, { connectionId: acmeConnection, pageId: '222' });
    await connectPage(globex.token, { connectionId: globexConnection, pageId: '333' });
  });

  const checkConnection = (token, id) =>
    request(app).post(`${API}/facebook/connections/${id}/check`).set(bearer(token));

  it('invalidates a connection’s Pages when its token turns out to be dead', async () => {
    mockGraph(routes({ 'GET /debug_token': deadUserToken() }));

    await checkConnection(acme.token, acmeConnection);

    for (const pageId of ['111', '222']) {
      const page = await storedPage(acme.workspace.id, pageId);
      expect(page.status).toBe('invalid');
      expect(page.pageTokenCipher).toBeUndefined();
    }
    expect((await storedPage(globex.workspace.id, '333')).status).toBe('active');
  });

  it('deletes a connection’s Pages when the connection is disconnected', async () => {
    mockGraph(routes());

    await request(app)
      .delete(`${API}/facebook/connections/${acmeConnection}`)
      .set(bearer(acme.token));

    expect(await FacebookPage.inWorkspace(acme.workspace.id).countDocuments()).toBe(0);
    expect(await FacebookPage.inWorkspace(globex.workspace.id).countDocuments()).toBe(1);
  });

  it('invalidates Pages in every workspace when the user removes the app on Facebook', async () => {
    const signed = signedRequest(
      { algorithm: 'HMAC-SHA256', issued_at: 1, user_id: FB_USER },
      env.meta.appSecret,
    );

    await request(app)
      .post(`${API}/facebook/deauthorize`)
      .type('form')
      .send({ signed_request: signed });

    for (const [workspace, pageId] of [
      [acme.workspace, '111'],
      [acme.workspace, '222'],
      [globex.workspace, '333'],
    ]) {
      const page = await storedPage(workspace.id, pageId);
      expect(page.status).toBe('invalid');
      expect(page.pageTokenCipher).toBeUndefined();
    }
  });

  it('restores the Pages when the connection is renewed', async () => {
    mockGraph(routes({ 'GET /debug_token': deadUserToken() }));
    await checkConnection(acme.token, acmeConnection);
    expect((await storedPage(acme.workspace.id, '111')).status).toBe('invalid');

    mockGraph(routes());
    const res = await completeLogin(acme);

    expect(res.headers.location).toContain('facebook=connected');
    for (const pageId of ['111', '222']) {
      const page = await storedPage(acme.workspace.id, pageId);
      expect(page.status).toBe('active');
      expect(page.statusReason).toBeNull();
      expect(
        tokenCrypto.decrypt(page.pageTokenCipher, pageTokenAad(acme.workspace.id, pageId)),
      ).toBe(`PAGE_TOKEN_${pageId}`);
    }
  });

  it('keeps the login working when Pages cannot be restored', async () => {
    mockGraph(routes({ 'GET /debug_token': deadUserToken() }));
    await checkConnection(acme.token, acmeConnection);

    mockGraph(routes({ 'GET /me/accounts': graphError(500, { code: 2 }) }));
    const res = await completeLogin(acme);

    expect(res.headers.location).toContain('facebook=connected');
    expect((await storedPage(acme.workspace.id, '111')).status).toBe('invalid');
  });

  it('only restores Pages the account still manages', async () => {
    mockGraph(routes({ 'GET /debug_token': deadUserToken() }));
    await checkConnection(acme.token, acmeConnection);

    mockGraph(
      routes({
        'GET /me/accounts': reply({
          data: [
            {
              id: '111',
              name: 'Acme Realty',
              access_token: 'PAGE_TOKEN_111',
              tasks: ['ADVERTISE'],
            },
          ],
        }),
      }),
    );
    await completeLogin(acme);

    expect((await storedPage(acme.workspace.id, '111')).status).toBe('active');
    expect((await storedPage(acme.workspace.id, '222')).status).toBe('invalid');
  });
});

// A Page as Facebook returns it when the user cannot obtain an access token for it.
const PAGES_WITHOUT_TOKEN = {
  id: '111',
  name: 'Acme Realty',
  category: 'Real Estate',
  tasks: ['MANAGE'],
};
