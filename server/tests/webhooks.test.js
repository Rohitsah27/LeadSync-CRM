import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { FacebookPage } from '../models/FacebookPage.js';
import { Lead } from '../models/Lead.js';
import { LeadForm } from '../models/LeadForm.js';
import { WebhookEvent } from '../models/WebhookEvent.js';
import { createWebhookWorker } from '../services/webhookWorker.js';
import { processPendingEvents } from '../services/webhookProcessor.service.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db.js';
import {
  API,
  bearer,
  createFlow,
  FORMS,
  graphRoutes,
  makeLead,
  pageRoutes,
  pageTokenInfo,
  tokenInfo,
} from './helpers/facebookFlow.js';
import { graphError, mockGraph, reply } from './helpers/graphMock.js';

const app = createApp();
const { signUp, connectPageFor } = createFlow(app);
const URL_PATH = `${API}/webhooks/meta`;

const sign = (raw, secret = env.meta.appSecret) =>
  `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

/** A Meta "new lead" notification for each id, shaped like the real thing. */
const payloadFor = (leadgenIds, { pageId = '111', formId = '555' } = {}) => ({
  object: 'page',
  entry: leadgenIds.map((leadgenId) => ({
    id: pageId,
    time: 1_700_000_000,
    changes: [
      {
        field: 'leadgen',
        value: {
          leadgen_id: leadgenId,
          page_id: pageId,
          form_id: formId,
          ad_id: '777',
          adgroup_id: '888',
          created_time: 1_700_000_000,
        },
      },
    ],
  })),
});

/** POSTs a webhook exactly as Meta would: raw JSON bytes plus a signature over those bytes. */
function deliver(body, { signature, contentType = 'application/json', secret } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const req = request(app).post(URL_PATH).set('Content-Type', contentType);
  if (signature !== null) req.set('X-Hub-Signature-256', signature ?? sign(raw, secret));
  return req.send(raw);
}

const lead = (id) => makeLead(1, { id: String(id) });
const leadRoutes = (ids) => Object.fromEntries(ids.map((id) => [`GET /${id}`, reply(lead(id))]));

/** A Graph API where leads 9001-9009 exist and Acme's Page has the usual forms. */
const graph = (overrides = {}) =>
  mockGraph(
    graphRoutes(
      pageRoutes({
        'GET /111/leadgen_forms': reply({ data: FORMS }),
        ...leadRoutes([9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009]),
        ...overrides,
      }),
    ),
  );

const eventOf = (workspaceId, leadgenId) =>
  WebhookEvent.inWorkspace(workspaceId).findOne({ leadgenId });
const callsTo = (calls, path) => calls.filter((call) => call.path === path);
const dueNow = (workspaceId, leadgenId, fields = {}) =>
  WebhookEvent.inWorkspace(workspaceId).updateOne(
    { leadgenId },
    { nextAttemptAt: new Date(Date.now() - 1000), ...fields },
  );

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
  await connectPageFor(acme, '111');
  await connectPageFor(globex, '333');
});

describe('GET /webhooks/meta (setup verification)', () => {
  const verify = (query) => request(app).get(URL_PATH).query(query);
  const valid = {
    'hub.mode': 'subscribe',
    'hub.verify_token': 'test-webhook-verify-token-123',
    'hub.challenge': '1158201444',
  };

  it('echoes the challenge as plain text when the token is right, with no login needed', async () => {
    const res = await verify(valid);

    expect(res.status).toBe(200);
    expect(res.text).toBe('1158201444');
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
  });

  it.each([
    ['a wrong token', { 'hub.verify_token': 'nope-nope-nope-nope' }],
    ['a missing token', { 'hub.verify_token': undefined }],
    ['a different mode', { 'hub.mode': 'unsubscribe' }],
    ['a token that is only a prefix of the real one', { 'hub.verify_token': 'test-webhook' }],
  ])('refuses %s', async (_label, override) => {
    const res = await verify({ ...valid, ...override });

    expect(res.status).toBe(403);
    expect(res.text).not.toContain('1158201444');
  });

  it.each([
    ['markup', '<script>alert(1)</script>'],
    ['a very long value', 'a'.repeat(500)],
    ['a missing challenge', undefined],
  ])('will not echo %s', async (_label, challenge) => {
    const res = await verify({ ...valid, 'hub.challenge': challenge });

    expect(res.status).toBe(400);
    expect(res.text).not.toContain('<script>');
  });
});

describe('POST /webhooks/meta (signature)', () => {
  beforeEach(() => {
    graph();
  });

  it('accepts a correctly signed notification', async () => {
    const res = await deliver(payloadFor(['9001']));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: 1, duplicates: 0, unknownPages: 0 });
  });

  it.each([
    ['no signature', null],
    ['an empty signature', ''],
    ['a signature without the sha256= prefix', 'a'.repeat(64)],
    ['a signature of the wrong length', 'sha256=abcd'],
    ['a signature that is not hexadecimal', `sha256=${'z'.repeat(64)}`],
    ['a signature made with another secret', undefined],
  ])('rejects %s', async (label, signature) => {
    const body = payloadFor(['9001']);
    const res =
      label === 'a signature made with another secret'
        ? await deliver(body, { secret: 'a-different-app-secret' })
        : await deliver(body, { signature });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    expect(await WebhookEvent.countDocuments().unscoped()).toBe(0);
  });

  it('rejects a body that was altered after it was signed', async () => {
    const original = JSON.stringify(payloadFor(['9001']));
    const forged = original.replace('9001', '9002');

    const res = await deliver(forged, { signature: sign(original) });

    expect(res.status).toBe(401);
    expect(await WebhookEvent.countDocuments().unscoped()).toBe(0);
  });

  it('verifies the exact bytes received, not a re-serialised copy', async () => {
    // Meta escapes characters and spaces JSON differently from JSON.stringify.
    const raw =
      '{"object": "page",\n  "entry": [{"id": "111", "changes": [{"field": "leadgen", "value": ' +
      '{"leadgen_id": "9001", "page_id": "111", "note": "\\u00e4"}}]}]}';
    expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw);

    const res = await deliver(raw);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(1);
  });

  it('refuses a correctly signed body that is not JSON', async () => {
    const res = await deliver('this is not json');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('refuses a request that is not sent as JSON, however it is signed', async () => {
    const res = await deliver(payloadFor(['9001']), { contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_WEBHOOK');
  });

  it('is not limited by the per-address API rate limit', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) => deliver(payloadFor([`91${index}`]))),
    );

    expect(results.every((res) => res.status === 200)).toBe(true);
  });
});

describe('ingestion', () => {
  it('saves a pending event in the workspace that owns the Page, without calling Facebook', async () => {
    const { calls } = graph();

    const res = await deliver(payloadFor(['9001']));

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0);
    const event = await eventOf(acme.workspace.id, '9001');
    expect(event).toMatchObject({
      pageId: '111',
      formId: '555',
      adId: '777',
      status: 'pending',
      attempts: 0,
    });
    expect(event.leadCreatedTime.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(event.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('routes each event to the workspace that owns its Page', async () => {
    graph();
    const body = {
      object: 'page',
      entry: [
        ...payloadFor(['9001'], { pageId: '111' }).entry,
        ...payloadFor(['9002'], { pageId: '333' }).entry,
      ],
    };

    const res = await deliver(body);

    expect(res.body.received).toBe(2);
    expect(await eventOf(acme.workspace.id, '9001')).toBeTruthy();
    expect(await eventOf(globex.workspace.id, '9001')).toBeNull();
    expect(await eventOf(globex.workspace.id, '9002')).toBeTruthy();
    expect(await eventOf(acme.workspace.id, '9002')).toBeNull();
  });

  it('stores a repeated delivery of the same lead once', async () => {
    graph();

    const first = await deliver(payloadFor(['9001']));
    const second = await deliver(payloadFor(['9001']));

    expect(first.body).toMatchObject({ received: 1, duplicates: 0 });
    expect(second.body).toMatchObject({ received: 0, duplicates: 1 });
    expect(await WebhookEvent.inWorkspace(acme.workspace.id).countDocuments()).toBe(1);
  });

  it('handles the same lead twice in one batch', async () => {
    graph();

    const res = await deliver(payloadFor(['9001', '9001', '9002']));

    expect(res.body).toMatchObject({ received: 2, duplicates: 1 });
  });

  it('answers 200 and stores nothing for a Page it does not serve', async () => {
    graph();

    const res = await deliver(payloadFor(['9001'], { pageId: '999' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: 0, duplicates: 0, unknownPages: 1 });
    expect(await WebhookEvent.countDocuments().unscoped()).toBe(0);
  });

  it.each([
    ['another object', { object: 'user', entry: payloadFor(['9001']).entry }],
    ['no entries', { object: 'page' }],
    ['entries that are not a list', { object: 'page', entry: 'nope' }],
    ['an empty entry', { object: 'page', entry: [{}] }],
    [
      'a different field',
      {
        object: 'page',
        entry: [{ id: '111', changes: [{ field: 'feed', value: { leadgen_id: '9001' } }] }],
      },
    ],
    [
      'a change with no value',
      { object: 'page', entry: [{ id: '111', changes: [{ field: 'leadgen' }] }] },
    ],
    ['a non-numeric lead id', payloadFor(['abc'])],
    [
      'a lead id that is an unsafe number',
      // Sent as raw text: a number this large cannot even be written in JavaScript source safely.
      '{"object":"page","entry":[{"id":"111","changes":[{"field":"leadgen","value":{"leadgen_id":90071992547409930000}}]}]}',
    ],
    [
      'contradictory Page ids',
      {
        object: 'page',
        entry: [
          {
            id: '111',
            changes: [{ field: 'leadgen', value: { leadgen_id: '9001', page_id: '333' } }],
          },
        ],
      },
    ],
    [
      'no Page id at all',
      {
        object: 'page',
        entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id: '9001' } }] }],
      },
    ],
  ])('skips %s without failing the delivery', async (_label, body) => {
    graph();

    const res = await deliver(body);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(0);
    expect(await WebhookEvent.countDocuments().unscoped()).toBe(0);
  });

  it('takes the good items from a batch that also holds bad ones', async () => {
    graph();
    const body = {
      object: 'page',
      entry: [
        { id: '111', changes: [{ field: 'leadgen', value: { leadgen_id: 'bad' } }] },
        ...payloadFor(['9001']).entry,
        { id: '111', changes: [{ field: 'feed', value: {} }] },
      ],
    };

    const res = await deliver(body);

    expect(res.body.received).toBe(1);
  });

  it('accepts a lead id sent as a safe number', async () => {
    graph();
    const body = {
      object: 'page',
      entry: [{ id: '111', changes: [{ field: 'leadgen', value: { leadgen_id: 9001 } }] }],
    };

    expect((await deliver(body)).body.received).toBe(1);
    expect(await eventOf(acme.workspace.id, '9001')).toBeTruthy();
  });
});

describe('processing events', () => {
  beforeEach(() => {
    graph();
  });

  it('fetches the lead with the Page token and stores it, then marks the event done', async () => {
    await deliver(payloadFor(['9001']));
    const { calls } = graph();

    const handled = await processPendingEvents();

    expect(handled).toBe(1);
    const fetchCall = callsTo(calls, '/9001')[0];
    expect(fetchCall.params.access_token).toBe('PAGE_TOKEN_111');
    expect(fetchCall.params.appsecret_proof).toMatch(/^[0-9a-f]{64}$/);

    const stored = await Lead.inWorkspace(acme.workspace.id).findOne({ facebookLeadId: '9001' });
    expect(stored).toMatchObject({
      fullName: 'Person 1',
      email: 'person1@example.com',
      pageId: '111',
      pageName: 'Acme Realty',
      formId: '555',
      formName: 'Spring Offer',
      leadStatus: 'new',
    });

    const event = await eventOf(acme.workspace.id, '9001');
    expect(event).toMatchObject({ status: 'processed', result: 'created', lastError: null });
    expect(event.processedAt).toBeInstanceOf(Date);
    expect(event.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
  });

  it('records when the Page last received a lead', async () => {
    await deliver(payloadFor(['9001']));

    await processPendingEvents();

    const page = await FacebookPage.inWorkspace(acme.workspace.id).findOne({ pageId: '111' });
    expect(page.lastWebhookAt).toBeInstanceOf(Date);
  });

  it('keeps each lead in the workspace of its Page', async () => {
    await deliver({
      object: 'page',
      entry: [
        ...payloadFor(['9001'], { pageId: '111' }).entry,
        ...payloadFor(['9002'], { pageId: '333' }).entry,
      ],
    });
    graph({ 'GET /333/leadgen_forms': reply({ data: [{ ...FORMS[0], id: '555' }] }) });

    await processPendingEvents();

    expect(
      await Lead.inWorkspace(acme.workspace.id).countDocuments({ facebookLeadId: '9001' }),
    ).toBe(1);
    expect(
      await Lead.inWorkspace(acme.workspace.id).countDocuments({ facebookLeadId: '9002' }),
    ).toBe(0);
    expect(
      await Lead.inWorkspace(globex.workspace.id).countDocuments({ facebookLeadId: '9002' }),
    ).toBe(1);
  });

  it('loads the Page’s forms the first time it sees an unknown one, and not again', async () => {
    await deliver(payloadFor(['9001', '9002']));
    const { calls } = graph();

    await processPendingEvents();

    expect(callsTo(calls, '/111/leadgen_forms')).toHaveLength(1);
    expect(await LeadForm.inWorkspace(acme.workspace.id).countDocuments()).toBe(2);
  });

  it('does not store a lead twice when a manual sync already has it', async () => {
    await deliver(payloadFor(['9001']));
    await Lead.inWorkspace(acme.workspace.id).create({
      pageId: '111',
      formId: '555',
      facebookLeadId: '9001',
      createdTime: new Date(),
      leadStatus: 'contacted',
    });

    await processPendingEvents();

    expect(await Lead.inWorkspace(acme.workspace.id).countDocuments()).toBe(1);
    expect((await eventOf(acme.workspace.id, '9001')).result).toBe('duplicate');
    const existing = await Lead.inWorkspace(acme.workspace.id).findOne({ facebookLeadId: '9001' });
    expect(existing.leadStatus).toBe('contacted');
  });

  it('skips a lead from a form that is not included in automatic sync', async () => {
    await LeadForm.inWorkspace(acme.workspace.id).create({
      pageId: '111',
      formId: '555',
      name: 'Spring Offer',
      syncEnabled: false,
    });
    await deliver(payloadFor(['9001']));

    await processPendingEvents();

    expect(await Lead.inWorkspace(acme.workspace.id).countDocuments()).toBe(0);
    expect(await eventOf(acme.workspace.id, '9001')).toMatchObject({
      status: 'ignored',
      lastError: 'The form is not included in automatic sync.',
    });
  });

  it('ignores an event whose Page was disconnected after it arrived', async () => {
    await deliver(payloadFor(['9001']));
    await FacebookPage.inWorkspace(acme.workspace.id).deleteOne({ pageId: '111' });
    const { calls } = graph();

    await processPendingEvents();

    expect(await eventOf(acme.workspace.id, '9001')).toMatchObject({ status: 'ignored' });
    expect(callsTo(calls, '/9001')).toHaveLength(0);
  });

  it('fails an event for a Page that lost its token, without calling Facebook', async () => {
    await deliver(payloadFor(['9001']));
    await FacebookPage.inWorkspace(acme.workspace.id).updateOne(
      { pageId: '111' },
      { status: 'invalid', $unset: { pageTokenCipher: '' } },
    );
    const { calls } = graph();

    await processPendingEvents();

    const event = await eventOf(acme.workspace.id, '9001');
    expect(event.status).toBe('failed');
    expect(event.lastError).toMatch(/connection renewed/);
    expect(callsTo(calls, '/9001')).toHaveLength(0);
  });

  it('only handles events that are due', async () => {
    await deliver(payloadFor(['9001', '9002']));
    await WebhookEvent.inWorkspace(acme.workspace.id).updateOne(
      { leadgenId: '9002' },
      { nextAttemptAt: new Date(Date.now() + 60_000) },
    );

    expect(await processPendingEvents()).toBe(1);
    expect((await eventOf(acme.workspace.id, '9002')).status).toBe('pending');
  });

  it('stops after the limit it was given', async () => {
    await deliver(payloadFor(['9001', '9002', '9003']));

    expect(await processPendingEvents({ limit: 2 })).toBe(2);
    expect(await processPendingEvents()).toBe(1);
  });

  it('retries with fewer fields when Facebook rejects the lead field list', async () => {
    await deliver(payloadFor(['9001']));
    const { calls } = graph({
      'GET /9001': ({ params }) =>
        params.fields.includes('is_organic')
          ? graphError(400, { code: 100, message: 'Unsupported field' })
          : reply(lead(9001)),
    });

    await processPendingEvents();

    expect(callsTo(calls, '/9001')).toHaveLength(2);
    expect((await eventOf(acme.workspace.id, '9001')).status).toBe('processed');
  });
});

describe('failures and retries', () => {
  beforeEach(async () => {
    graph();
    await deliver(payloadFor(['9001']));
  });

  it.each([
    ['Facebook being unavailable', graphError(500, { code: 2 }), /could not be reached/],
    ['Facebook rate limiting', graphError(400, { code: 4 }), /limiting/],
  ])('schedules another attempt after %s', async (_label, failure, message) => {
    graph({ 'GET /9001': failure });

    await processPendingEvents();

    const event = await eventOf(acme.workspace.id, '9001');
    expect(event).toMatchObject({ status: 'retry', attempts: 1 });
    expect(event.lastError).toMatch(message);
    expect(event.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(await Lead.inWorkspace(acme.workspace.id).countDocuments()).toBe(0);

    // Not due yet, so another pass leaves it alone.
    expect(await processPendingEvents()).toBe(0);
  });

  it('succeeds on a later attempt once Facebook recovers', async () => {
    graph({ 'GET /9001': graphError(500, { code: 2 }) });
    await processPendingEvents();

    graph();
    await dueNow(acme.workspace.id, '9001');
    await processPendingEvents();

    const event = await eventOf(acme.workspace.id, '9001');
    expect(event).toMatchObject({ status: 'processed', result: 'created', attempts: 2 });
    expect(await Lead.inWorkspace(acme.workspace.id).countDocuments()).toBe(1);
  });

  it('backs off for longer after each failed attempt', async () => {
    const delays = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      graph({ 'GET /9001': graphError(500, { code: 2 }) });
      await processPendingEvents();
      const event = await eventOf(acme.workspace.id, '9001');
      delays.push(event.nextAttemptAt.getTime() - Date.now());
      await dueNow(acme.workspace.id, '9001');
    }

    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[2]).toBeGreaterThan(delays[1]);
  });

  it('gives up after enough attempts', async () => {
    await WebhookEvent.inWorkspace(acme.workspace.id).updateOne(
      { leadgenId: '9001' },
      { attempts: 5 },
    );
    graph({ 'GET /9001': graphError(500, { code: 2 }) });

    await processPendingEvents();

    const event = await eventOf(acme.workspace.id, '9001');
    expect(event.status).toBe('failed');
    expect(event.lastError).toMatch(/Gave up after 6 attempts/);
    expect(event.expiresAt).toBeInstanceOf(Date);
  });

  it('fails at once, and marks the Page invalid, when Facebook rejects its token', async () => {
    graph({
      'GET /9001': graphError(400, { code: 190 }),
      'GET /debug_token': ({ params }) =>
        reply({
          data: params.input_token.startsWith('PAGE_TOKEN')
            ? pageTokenInfo({ is_valid: false, error: { code: 190, message: 'Token expired' } })
            : tokenInfo(),
        }),
    });

    await processPendingEvents();

    expect(await eventOf(acme.workspace.id, '9001')).toMatchObject({
      status: 'failed',
      attempts: 1,
    });
    const page = await FacebookPage.inWorkspace(acme.workspace.id).findOne({ pageId: '111' });
    expect(page.status).toBe('invalid');
  });

  it('fails at once, without retrying, on a missing permission', async () => {
    graph({ 'GET /9001': graphError(403, { code: 200 }) });

    await processPendingEvents();

    const event = await eventOf(acme.workspace.id, '9001');
    expect(event).toMatchObject({ status: 'failed', attempts: 1 });
    expect(event.lastError).toMatch(/leads_retrieval/);
  });

  it('fails at once when Facebook keeps rejecting the request', async () => {
    graph({ 'GET /9001': graphError(400, { code: 100 }) });

    await processPendingEvents();

    expect(await eventOf(acme.workspace.id, '9001')).toMatchObject({
      status: 'failed',
      lastError: 'Facebook rejected the request.',
    });
  });

  it('retries an unexpected internal error instead of losing the event', async () => {
    await FacebookPage.inWorkspace(acme.workspace.id).updateOne(
      { pageId: '111' },
      { pageTokenCipher: 'not-a-valid-ciphertext' },
    );

    await processPendingEvents();

    expect(await eventOf(acme.workspace.id, '9001')).toMatchObject({
      status: 'retry',
      lastError: 'An unexpected error occurred.',
    });
  });
});

describe('several workers at once', () => {
  it('handles each event exactly once', async () => {
    const { calls } = graph();
    await deliver(payloadFor(['9001', '9002', '9003', '9004', '9005']));

    const handled = await Promise.all([processPendingEvents(), processPendingEvents()]);

    expect(handled[0] + handled[1]).toBe(5);
    expect(await Lead.inWorkspace(acme.workspace.id).countDocuments()).toBe(5);
    for (const id of ['9001', '9002', '9003', '9004', '9005']) {
      expect(callsTo(calls, `/${id}`)).toHaveLength(1);
    }
  });

  it('takes over an event stuck in processing by a worker that died, but not one in progress', async () => {
    graph();
    await deliver(payloadFor(['9001', '9002']));
    const scoped = WebhookEvent.inWorkspace(acme.workspace.id);
    await scoped.updateOne(
      { leadgenId: '9001' },
      { status: 'processing', lockedAt: new Date(Date.now() - 10 * 60_000) },
    );
    await scoped.updateOne({ leadgenId: '9002' }, { status: 'processing', lockedAt: new Date() });

    expect(await processPendingEvents()).toBe(1);
    expect((await eventOf(acme.workspace.id, '9001')).status).toBe('processed');
    expect((await eventOf(acme.workspace.id, '9002')).status).toBe('processing');
  });
});

describe('the background worker', () => {
  it('processes events by itself and stops when told to', async () => {
    graph();
    const worker = createWebhookWorker({ intervalMs: 20 });
    worker.start();
    try {
      await deliver(payloadFor(['9001']));

      await vi.waitFor(async () => {
        expect((await eventOf(acme.workspace.id, '9001')).status).toBe('processed');
      });
    } finally {
      await worker.stop();
    }

    await deliver(payloadFor(['9002']));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await eventOf(acme.workspace.id, '9002')).status).toBe('pending');
    expect(worker.isRunning).toBe(false);
  });

  it('picks up events left over from before it started', async () => {
    graph();
    await deliver(payloadFor(['9001']));
    const worker = createWebhookWorker({ intervalMs: 10_000 });

    worker.start();
    try {
      await vi.waitFor(async () => {
        expect((await eventOf(acme.workspace.id, '9001')).status).toBe('processed');
      });
    } finally {
      await worker.stop();
    }
  });

  it('runs once on start however many times it is started, and again on wake', async () => {
    const run = vi.fn().mockResolvedValue(0);
    const worker = createWebhookWorker({ intervalMs: 60_000, run });

    worker.start();
    worker.start();
    await worker.stop();
    expect(run).toHaveBeenCalledTimes(1);

    worker.start();
    worker.wake();
    await worker.stop();
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does nothing on wake when it has not been started', async () => {
    const run = vi.fn().mockResolvedValue(0);
    const worker = createWebhookWorker({ intervalMs: 60_000, run });

    worker.wake();
    await worker.stop();

    expect(run).not.toHaveBeenCalled();
  });

  it('folds wake-ups that arrive during a run into one more run', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const run = vi
      .fn()
      .mockImplementationOnce(() => gate)
      .mockResolvedValue(0);
    const worker = createWebhookWorker({ intervalMs: 60_000, run });

    worker.start();
    worker.wake();
    worker.wake();
    worker.wake();
    expect(run).toHaveBeenCalledTimes(1);

    release();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    await worker.stop();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('waits for the run in progress before it says it has stopped', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const run = vi.fn().mockImplementation(() => gate);
    const worker = createWebhookWorker({ intervalMs: 60_000, run });
    let stopped = false;

    worker.start();
    worker.wake();
    const stopping = worker.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(stopped).toBe(false);

    release();
    await stopping;

    expect(stopped).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('survives a run that throws', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(0);
    const worker = createWebhookWorker({ intervalMs: 60_000, run });

    worker.start();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    worker.wake();
    await worker.stop();

    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('webhook behaviour that is safe by design', () => {
  it('only needs the app secret and verify token, not a login', async () => {
    graph();

    const res = await request(app)
      .post(URL_PATH)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(JSON.stringify(payloadFor(['9001']))))
      .send(JSON.stringify(payloadFor(['9001'])));

    expect(res.status).toBe(200);
  });

  it('does not confuse a user’s bearer token with a signature', async () => {
    graph();

    const res = await request(app)
      .post(URL_PATH)
      .set(bearer(acme.token))
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payloadFor(['9001'])));

    expect(res.status).toBe(401);
    expect(await WebhookEvent.countDocuments().unscoped()).toBe(0);
  });
});
