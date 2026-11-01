import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { FacebookConnection } from '../models/FacebookConnection.js';
import { FacebookPage } from '../models/FacebookPage.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db.js';
import {
  API,
  bearer,
  createFlow,
  graphRoutes,
  pageRoutes,
  tokenInfo,
} from './helpers/facebookFlow.js';
import { graphError, mockGraph, reply } from './helpers/graphMock.js';

const app = createApp();
const { signUp, addMember, completeLogin } = createFlow(app);

const routes = (overrides = {}) => graphRoutes(pageRoutes(overrides));
const callsTo = (calls, method, path) =>
  calls.filter((call) => call.method === method && call.path === path);
const refused = graphError(403, { code: 200, message: 'Requires pages_manage_metadata' });
const deadUserToken = () =>
  reply({
    data: tokenInfo({
      is_valid: false,
      error: { code: 190, subcode: 463, message: 'Session has expired' },
    }),
  });

const storedPage = (workspaceId, pageId) =>
  FacebookPage.inWorkspace(workspaceId).findOne({ pageId }).select('+pageTokenCipher');

let acme;
let globex;
let connectionId;

/** Signs the account's Facebook in without connecting any Page yet. */
async function loginTo(account) {
  mockGraph(routes());
  await completeLogin(account);
  const connection = await FacebookConnection.inWorkspace(account.workspace.id).findOne();
  return String(connection._id);
}

const connectPage = (account, connection, pageId) =>
  request(app)
    .post(`${API}/facebook/pages`)
    .set(bearer(account.token))
    .send({ connectionId: connection, pageId });
const subscribe = (token, pageId) =>
  request(app).post(`${API}/facebook/pages/${pageId}/subscription`).set(bearer(token));
const check = (token, pageId) =>
  request(app).post(`${API}/facebook/pages/${pageId}/check`).set(bearer(token));
const disconnectPage = (token, pageId) =>
  request(app).delete(`${API}/facebook/pages/${pageId}`).set(bearer(token));

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(() => {
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  await clearTestDb();
  acme = await signUp('owner@acme.example', 'Acme Realty');
  globex = await signUp('owner@globex.example', 'Globex Autos');
  connectionId = await loginTo(acme);
});

describe('connecting a Page', () => {
  it('subscribes it to new-lead notifications with the Page token', async () => {
    const { calls } = mockGraph(routes());

    const res = await connectPage(acme, connectionId, '111');

    expect(res.status).toBe(201);
    const [call] = callsTo(calls, 'POST', '/111/subscribed_apps');
    expect(call.params).toMatchObject({
      subscribed_fields: 'leadgen',
      access_token: 'PAGE_TOKEN_111',
    });
    expect(call.params.appsecret_proof).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.page.webhook).toMatchObject({
      subscribed: true,
      error: null,
      lastEventAt: null,
    });
    expect(res.body.page.webhook.subscribedAt).toEqual(expect.any(String));
  });

  it('still connects when Facebook refuses the subscription, and says why', async () => {
    mockGraph(routes({ 'POST /111/subscribed_apps': refused }));

    const res = await connectPage(acme, connectionId, '111');

    expect(res.status).toBe(201);
    expect(res.body.page.status).toBe('active');
    expect(res.body.page.webhook.subscribed).toBe(false);
    expect(res.body.page.webhook.error).toMatch(/pages_manage_metadata/);
  });

  it('still connects when Facebook is down during the subscription', async () => {
    mockGraph(routes({ 'POST /111/subscribed_apps': graphError(500, { code: 2 }) }));

    const res = await connectPage(acme, connectionId, '111');

    expect(res.status).toBe(201);
    expect(res.body.page.webhook).toMatchObject({ subscribed: false });
    expect(res.body.page.webhook.error).toMatch(/could not be reached/);
  });
});

describe('POST /facebook/pages/:pageId/subscription', () => {
  beforeEach(async () => {
    mockGraph(routes({ 'POST /111/subscribed_apps': refused }));
    await connectPage(acme, connectionId, '111');
  });

  it('retries the subscription and clears the earlier error', async () => {
    mockGraph(routes());

    const res = await subscribe(acme.token, '111');

    expect(res.status).toBe(200);
    expect(res.body.page.webhook).toMatchObject({ subscribed: true, error: null });
  });

  it('reports a refusal and keeps the reason on the Page', async () => {
    mockGraph(routes({ 'POST /111/subscribed_apps': refused }));

    const res = await subscribe(acme.token, '111');

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('WEBHOOK_SUBSCRIPTION_FAILED');
    expect(res.body.error.message).toMatch(/pages_manage_metadata/);
    const page = await storedPage(acme.workspace.id, '111');
    expect(page.webhookSubscribed).toBe(false);
    expect(page.webhookError).toMatch(/pages_manage_metadata/);
  });

  it('is limited to admins and to the workspace’s own Pages', async () => {
    const memberToken = await addMember(acme.workspace.id, 'member@acme.example', 'member');
    mockGraph(routes());

    expect((await request(app).post(`${API}/facebook/pages/111/subscription`)).status).toBe(401);
    expect((await subscribe(memberToken, '111')).status).toBe(403);
    expect((await subscribe(globex.token, '111')).status).toBe(404);
    expect((await subscribe(acme.token, '999')).status).toBe(404);
    expect((await subscribe(acme.token, 'abc')).status).toBe(404);
  });

  it('needs a Page that still has its token, and does not call Facebook without one', async () => {
    await FacebookPage.inWorkspace(acme.workspace.id).updateOne(
      { pageId: '111' },
      { status: 'invalid', $unset: { pageTokenCipher: '' } },
    );
    const { calls } = mockGraph(routes());

    const res = await subscribe(acme.token, '111');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAGE_NOT_ACTIVE');
    expect(callsTo(calls, 'POST', '/111/subscribed_apps')).toHaveLength(0);
  });
});

describe('re-checking a Page', () => {
  beforeEach(async () => {
    mockGraph(routes());
    await connectPage(acme, connectionId, '111');
  });

  const listing = (...apps) => reply({ data: apps });

  it.each([
    [
      'our app with new-lead notifications',
      listing({ id: env.meta.appId, subscribed_fields: ['leadgen'] }),
      true,
    ],
    ['no apps at all', listing(), false],
    ['only another app', listing({ id: '999', subscribed_fields: ['leadgen'] }), false],
    [
      'our app but for other things only',
      listing({ id: env.meta.appId, subscribed_fields: ['feed'] }),
      false,
    ],
    ['our app with no field list', listing({ id: env.meta.appId }), false],
  ])('shows what Facebook reports: %s', async (_label, response, expected) => {
    await FacebookPage.inWorkspace(acme.workspace.id).updateOne(
      { pageId: '111' },
      { webhookSubscribed: !expected },
    );
    mockGraph(routes({ 'GET /111/subscribed_apps': response }));

    const res = await check(acme.token, '111');

    expect(res.status).toBe(200);
    expect(res.body.page.webhook.subscribed).toBe(expected);
  });

  it('clears an earlier error once Facebook confirms the subscription', async () => {
    await FacebookPage.inWorkspace(acme.workspace.id).updateOne(
      { pageId: '111' },
      { webhookSubscribed: false, webhookError: 'Old problem' },
    );
    mockGraph(routes());

    const res = await check(acme.token, '111');

    expect(res.body.page.webhook).toMatchObject({ subscribed: true, error: null });
  });

  it('leaves the status alone when Facebook cannot answer', async () => {
    mockGraph(routes({ 'GET /111/subscribed_apps': graphError(500, { code: 2 }) }));

    const res = await check(acme.token, '111');

    expect(res.status).toBe(200);
    expect(res.body.page.webhook.subscribed).toBe(true);
  });
});

describe('disconnecting', () => {
  beforeEach(async () => {
    mockGraph(routes());
    await connectPage(acme, connectionId, '111');
    await connectPage(acme, connectionId, '222');
  });

  it('stops new-lead notifications for a disconnected Page', async () => {
    const { calls } = mockGraph(routes());

    const res = await disconnectPage(acme.token, '111');

    expect(res.status).toBe(204);
    const [call] = callsTo(calls, 'DELETE', '/111/subscribed_apps');
    expect(call.params.access_token).toBe('PAGE_TOKEN_111');
    expect(await storedPage(acme.workspace.id, '111')).toBeNull();
    expect(callsTo(calls, 'DELETE', '/222/subscribed_apps')).toHaveLength(0);
  });

  it('disconnects even when Facebook refuses to unsubscribe', async () => {
    mockGraph(routes({ 'DELETE /111/subscribed_apps': graphError(400, { code: 190 }) }));

    const res = await disconnectPage(acme.token, '111');

    expect(res.status).toBe(204);
    expect(await storedPage(acme.workspace.id, '111')).toBeNull();
  });

  it('does not call Facebook for a Page that already lost its token', async () => {
    await FacebookPage.inWorkspace(acme.workspace.id).updateOne(
      { pageId: '111' },
      { status: 'invalid', $unset: { pageTokenCipher: '' } },
    );
    const { calls } = mockGraph(routes());

    expect((await disconnectPage(acme.token, '111')).status).toBe(204);
    expect(callsTo(calls, 'DELETE', '/111/subscribed_apps')).toHaveLength(0);
  });

  it('stops notifications for every Page of a disconnected Facebook account', async () => {
    const globexConnection = await loginTo(globex);
    mockGraph(routes());
    await connectPage(globex, globexConnection, '333');
    const { calls } = mockGraph(routes());

    const res = await request(app)
      .delete(`${API}/facebook/connections/${connectionId}`)
      .set(bearer(acme.token));

    expect(res.status).toBe(204);
    expect(callsTo(calls, 'DELETE', '/111/subscribed_apps')).toHaveLength(1);
    expect(callsTo(calls, 'DELETE', '/222/subscribed_apps')).toHaveLength(1);
    expect(callsTo(calls, 'DELETE', '/333/subscribed_apps')).toHaveLength(0);
  });
});

describe('renewing a Facebook connection', () => {
  it('subscribes the restored Pages again', async () => {
    mockGraph(routes());
    await connectPage(acme, connectionId, '111');
    mockGraph(routes({ 'GET /debug_token': deadUserToken() }));
    await request(app)
      .post(`${API}/facebook/connections/${connectionId}/check`)
      .set(bearer(acme.token));
    await FacebookPage.inWorkspace(acme.workspace.id).updateOne(
      { pageId: '111' },
      { webhookSubscribed: false },
    );

    const { calls } = mockGraph(routes());
    await completeLogin(acme);

    const page = await storedPage(acme.workspace.id, '111');
    expect(page.status).toBe('active');
    expect(page.webhookSubscribed).toBe(true);
    expect(callsTo(calls, 'POST', '/111/subscribed_apps')).toHaveLength(1);
  });
});
