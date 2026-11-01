import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { FacebookPage } from '../models/FacebookPage.js';
import { Lead } from '../models/Lead.js';
import { LeadForm } from '../models/LeadForm.js';
import { leadPayloadAad } from '../services/leadSync.service.js';
import { tokenCrypto } from '../services/tokenCrypto.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db.js';
import {
  API,
  bearer,
  createFlow,
  FORMS,
  graphRoutes,
  makeLead,
  pagedLeads,
  pageRoutes,
  pageTokenInfo,
  tokenInfo,
} from './helpers/facebookFlow.js';
import { graphError, mockGraph, reply } from './helpers/graphMock.js';

const app = createApp();
const { signUp, addMember, connectPageFor } = createFlow(app);

const numbered = (numbers, overrides) => numbers.map((number) => makeLead(number, overrides));
const FIVE = numbered([1, 2, 3, 4, 5]);

/** A Graph API with two forms on Acme's Page and one on Globex's. Pass overrides to change it. */
const leadRoutes = (overrides = {}) =>
  graphRoutes(
    pageRoutes({
      'GET /111/leadgen_forms': reply({ data: FORMS }),
      'GET /333/leadgen_forms': reply({ data: [{ ...FORMS[0], id: '777', name: 'Globex Form' }] }),
      'GET /555/leads': pagedLeads(FIVE, 3),
      'GET /666/leads': reply({ data: [] }),
      'GET /777/leads': pagedLeads(numbered([1, 2], { form_id: '777' }), 3),
      ...overrides,
    }),
  );
const graph = (overrides) => mockGraph(leadRoutes(overrides));

const syncForms = (token, body) =>
  request(app).post(`${API}/forms/sync`).set(bearer(token)).send(body);
const syncLeads = (token, body) =>
  request(app).post(`${API}/leads/sync`).set(bearer(token)).send(body);
const listLeads = (token, query = {}) =>
  request(app).get(`${API}/leads`).set(bearer(token)).query(query);
const listForms = (token, query = {}) =>
  request(app).get(`${API}/forms`).set(bearer(token)).query(query);
const patchForm = (token, formId, body) =>
  request(app).patch(`${API}/forms/${formId}`).set(bearer(token)).send(body);

const leadsOf = (workspaceId) => Lead.inWorkspace(workspaceId).find().sort({ createdTime: -1 });
const formOf = (workspaceId, formId) => LeadForm.inWorkspace(workspaceId).findOne({ formId });
const callsTo = (calls, path) => calls.filter((call) => call.path === path);
const resultFor = (res, formId) => res.body.results.find((result) => result.formId === formId);

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

describe('POST /forms/sync', () => {
  it('stores the Page’s forms with their details', async () => {
    graph();

    const res = await syncForms(acme.token);

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { pageId: '111', name: 'Acme Realty', status: 'ok', message: null, forms: 2 },
    ]);
    const spring = res.body.forms.find((form) => form.formId === '555');
    expect(spring).toMatchObject({
      pageId: '111',
      name: 'Spring Offer',
      status: 'ACTIVE',
      locale: 'en_US',
      facebookLeadsCount: 8,
      storedLeads: 0,
      syncEnabled: true,
      questions: [
        { key: 'full_name', label: 'Full name', type: 'FULL_NAME' },
        { key: 'email', label: 'Email', type: 'EMAIL' },
      ],
    });
    expect(res.body.forms.find((form) => form.formId === '666').status).toBe('ARCHIVED');
  });

  it('can be repeated, updating forms without duplicating them or undoing a choice', async () => {
    graph();
    await syncForms(acme.token);
    await patchForm(acme.token, '555', { syncEnabled: false });
    graph({
      'GET /111/leadgen_forms': reply({
        data: [{ ...FORMS[0], name: 'Spring Offer 2' }, FORMS[1]],
      }),
    });

    const res = await syncForms(acme.token);

    expect(res.body.forms).toHaveLength(2);
    const spring = res.body.forms.find((form) => form.formId === '555');
    expect(spring.name).toBe('Spring Offer 2');
    expect(spring.syncEnabled).toBe(false);
  });

  it('marks a form Facebook no longer lists as deleted, without deleting it', async () => {
    graph();
    await syncForms(acme.token);
    graph({ 'GET /111/leadgen_forms': reply({ data: [FORMS[0]] }) });

    const res = await syncForms(acme.token);

    expect(res.body.forms.find((form) => form.formId === '666').status).toBe('DELETED');
    expect(res.body.forms.find((form) => form.formId === '555').status).toBe('ACTIVE');
  });

  it('retries with fewer fields when Facebook rejects the field list', async () => {
    const { calls } = graph({
      'GET /111/leadgen_forms': ({ params }) =>
        params.fields.includes('questions')
          ? graphError(400, { code: 100, message: 'Unsupported field' })
          : reply({ data: [{ id: '555', name: 'Spring Offer', status: 'ACTIVE' }] }),
    });

    const res = await syncForms(acme.token);

    const formCalls = callsTo(calls, '/111/leadgen_forms');
    expect(formCalls).toHaveLength(2);
    expect(formCalls[0].params.fields).not.toBe(formCalls[1].params.fields);
    expect(res.body.results[0].status).toBe('ok');
    expect(res.body.forms.map((form) => form.formId)).toEqual(['555']);
  });

  it('can be limited to one Page, and rejects a Page the workspace does not have', async () => {
    graph();

    expect((await syncForms(acme.token, { pageId: '111' })).status).toBe(200);
    expect((await syncForms(acme.token, { pageId: '333' })).status).toBe(404);
    expect((await syncForms(acme.token, { pageId: 'abc' })).status).toBe(400);
  });

  it('is limited to admins', async () => {
    const memberToken = await addMember(acme.workspace.id, 'member@acme.example', 'member');
    graph();

    expect((await request(app).post(`${API}/forms/sync`)).status).toBe(401);
    expect((await syncForms(memberToken)).status).toBe(403);
  });

  it('only touches the caller’s own workspace', async () => {
    graph();

    await syncForms(acme.token);

    expect(await LeadForm.inWorkspace(acme.workspace.id).countDocuments()).toBe(2);
    expect(await LeadForm.inWorkspace(globex.workspace.id).countDocuments()).toBe(0);
  });

  it('skips a Page whose connection needs renewing, without calling Facebook', async () => {
    await FacebookPage.inWorkspace(acme.workspace.id).updateOne(
      { pageId: '111' },
      { status: 'invalid', $unset: { pageTokenCipher: '' } },
    );
    const { calls } = graph();

    const res = await syncForms(acme.token);

    expect(res.body.results[0]).toMatchObject({ pageId: '111', status: 'invalid', forms: 0 });
    expect(callsTo(calls, '/111/leadgen_forms')).toHaveLength(0);
  });

  it.each([
    ['a missing permission', graphError(403, { code: 200 }), 'permission', /leads_retrieval/],
    ['rate limiting', graphError(400, { code: 4 }), 'rate_limited', /limiting/],
    ['Facebook being down', graphError(500, { code: 2 }), 'error', /could not be reached/],
  ])('reports %s for the Page and keeps going', async (_label, failure, status, message) => {
    graph({ 'GET /111/leadgen_forms': failure });

    const res = await syncForms(acme.token);

    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ status, forms: 0 });
    expect(res.body.results[0].message).toMatch(message);
  });

  it('marks the Page invalid when Facebook rejects its token', async () => {
    graph({
      'GET /111/leadgen_forms': graphError(400, { code: 190 }),
      'GET /debug_token': ({ params }) =>
        reply({
          data: params.input_token.startsWith('PAGE_TOKEN')
            ? pageTokenInfo({ is_valid: false, error: { code: 190, message: 'Token expired' } })
            : tokenInfo(),
        }),
    });

    const res = await syncForms(acme.token);

    expect(res.body.results[0].status).toBe('invalid');
    expect(
      (await FacebookPage.inWorkspace(acme.workspace.id).findOne({ pageId: '111' })).status,
    ).toBe('invalid');
  });
});

describe('GET /forms and PATCH /forms/:formId', () => {
  beforeEach(async () => {
    graph();
    await syncForms(acme.token);
    await syncForms(globex.token);
  });

  it('lists the workspace’s forms for any member, with how many leads are stored', async () => {
    const memberToken = await addMember(acme.workspace.id, 'member@acme.example', 'member');
    await syncLeads(acme.token, { formId: '555' });

    const res = await listForms(memberToken);

    expect(res.status).toBe(200);
    expect(res.body.forms.map((form) => form.formId).sort()).toEqual(['555', '666']);
    expect(res.body.forms.find((form) => form.formId === '555').storedLeads).toBe(5);
    expect(res.body.forms.find((form) => form.formId === '666').storedLeads).toBe(0);
    expect(JSON.stringify(res.body)).not.toMatch(/777|Globex/);
  });

  it('filters by Page and requires authentication', async () => {
    expect((await listForms(acme.token, { pageId: '999' })).body.forms).toEqual([]);
    expect((await listForms(acme.token, { pageId: '111' })).body.forms).toHaveLength(2);
    expect((await listForms(acme.token, { pageId: 'abc' })).status).toBe(400);
    expect((await request(app).get(`${API}/forms`)).status).toBe(401);
  });

  it('lets an admin switch syncing off and on for a form', async () => {
    const off = await patchForm(acme.token, '555', { syncEnabled: false });
    expect(off.body.form.syncEnabled).toBe(false);

    const on = await patchForm(acme.token, '555', { syncEnabled: true });
    expect(on.body.form.syncEnabled).toBe(true);
  });

  it('rejects members, other workspaces’ forms, unknown forms and bad input', async () => {
    const memberToken = await addMember(acme.workspace.id, 'member@acme.example', 'member');

    expect((await patchForm(memberToken, '555', { syncEnabled: false })).status).toBe(403);
    expect((await patchForm(acme.token, '777', { syncEnabled: false })).status).toBe(404);
    expect((await patchForm(acme.token, '999', { syncEnabled: false })).status).toBe(404);
    expect((await patchForm(acme.token, 'abc', { syncEnabled: false })).status).toBe(404);
    expect((await patchForm(acme.token, '555', { syncEnabled: 'yes' })).status).toBe(400);
    expect((await patchForm(acme.token, '555', {})).status).toBe(400);
    expect((await formOf(acme.workspace.id, '555')).syncEnabled).toBe(true);
  });
});

describe('POST /leads/sync', () => {
  beforeEach(async () => {
    graph();
    await syncForms(acme.token);
    await syncForms(globex.token);
  });

  it('stores each lead once, with its answers mapped and the original encrypted', async () => {
    const res = await syncLeads(acme.token, { formId: '555' });

    expect(res.status).toBe(200);
    expect(resultFor(res, '555')).toMatchObject({
      status: 'ok',
      message: null,
      fetched: 5,
      created: 5,
    });
    expect(res.body.totals).toEqual({ fetched: 5, created: 5 });

    const leads = await Lead.inWorkspace(acme.workspace.id)
      .find()
      .sort({ createdTime: -1 })
      .select('+rawPayloadCipher');
    expect(leads).toHaveLength(5);
    expect(leads[0]).toMatchObject({
      facebookLeadId: 'lead-1',
      fullName: 'Person 1',
      email: 'person1@example.com',
      phone: '+15550000001',
      leadStatus: 'new',
      source: 'facebook_lead_ads',
      pageId: '111',
      pageName: 'Acme Realty',
      formId: '555',
      formName: 'Spring Offer',
      assignedTo: null,
    });
    expect(leads[0].customFields.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: 'budget', value: '$500k' },
    ]);
    expect(leads[0].createdTime.toISOString()).toBe('2026-10-31T11:59:00.000Z');

    const stored = JSON.parse(
      tokenCrypto.decrypt(leads[0].rawPayloadCipher, leadPayloadAad(acme.workspace.id, 'lead-1')),
    );
    expect(stored).toEqual(FIVE[0]);
    expect(leads[0].rawPayloadCipher).not.toContain('person1@example.com');
  });

  it('records progress on the form', async () => {
    await syncLeads(acme.token, { formId: '555' });

    const form = await formOf(acme.workspace.id, '555');
    expect(form).toMatchObject({
      lastSyncStatus: 'ok',
      lastSyncMessage: null,
      backfillComplete: true,
      backfillCursor: null,
      syncingSince: null,
    });
    expect(form.lastSyncedAt).toBeInstanceOf(Date);
  });

  it('does not store a lead twice, and stops at the first page with nothing new', async () => {
    await syncLeads(acme.token, { formId: '555' });
    const { calls } = graph();

    const res = await syncLeads(acme.token, { formId: '555' });

    expect(resultFor(res, '555')).toMatchObject({ status: 'ok', fetched: 3, created: 0 });
    expect(callsTo(calls, '/555/leads')).toHaveLength(1);
    expect(await Lead.inWorkspace(acme.workspace.id).countDocuments()).toBe(5);
  });

  it('picks up only the new leads on a later sync', async () => {
    await syncLeads(acme.token, { formId: '555' });
    const { calls } = graph({ 'GET /555/leads': pagedLeads([makeLead(0), ...FIVE], 3) });

    const res = await syncLeads(acme.token, { formId: '555' });

    expect(resultFor(res, '555')).toMatchObject({ fetched: 6, created: 1 });
    expect(callsTo(calls, '/555/leads')).toHaveLength(2);
    expect(await Lead.inWorkspace(acme.workspace.id).countDocuments()).toBe(6);
  });

  it('never overwrites what someone changed on an existing lead', async () => {
    await syncLeads(acme.token, { formId: '555' });
    await Lead.inWorkspace(acme.workspace.id).updateOne(
      { facebookLeadId: 'lead-1' },
      { leadStatus: 'contacted', assignedTo: acme.user.id },
    );
    graph({ 'GET /555/leads': pagedLeads([makeLead(0), ...FIVE], 3) });

    await syncLeads(acme.token, { formId: '555' });

    const lead = await Lead.inWorkspace(acme.workspace.id).findOne({ facebookLeadId: 'lead-1' });
    expect(lead.leadStatus).toBe('contacted');
    expect(String(lead.assignedTo)).toBe(acme.user.id);
  });

  it('stops at the request limit and resumes from where it left off', async () => {
    const eight = numbered([1, 2, 3, 4, 5, 6, 7, 8]);
    graph({ 'GET /555/leads': pagedLeads(eight, 3) });

    const first = await syncLeads(acme.token, { formId: '555' });

    expect(resultFor(first, '555')).toMatchObject({ status: 'partial', created: 6 });
    expect(resultFor(first, '555').message).toMatch(/Sync again/);
    expect(await formOf(acme.workspace.id, '555')).toMatchObject({
      backfillComplete: false,
      backfillCursor: 'C6',
      lastSyncStatus: 'partial',
    });

    const { calls } = graph({ 'GET /555/leads': pagedLeads(eight, 3) });
    const second = await syncLeads(acme.token, { formId: '555' });

    expect(resultFor(second, '555')).toMatchObject({ status: 'ok', created: 2 });
    expect(callsTo(calls, '/555/leads')[0].params.after).toBe('C6');
    expect(await Lead.inWorkspace(acme.workspace.id).countDocuments()).toBe(8);
    expect(await formOf(acme.workspace.id, '555')).toMatchObject({
      backfillComplete: true,
      backfillCursor: null,
    });
  });

  it('does not lose leads when more arrive between syncs than one run can read', async () => {
    const original = numbered([10, 11, 12]);
    graph({ 'GET /555/leads': pagedLeads(original, 3) });
    await syncLeads(acme.token, { formId: '555' });

    const withNewOnes = [...numbered([1, 2, 3, 4, 5, 6, 7]), ...original];
    graph({ 'GET /555/leads': pagedLeads(withNewOnes, 3) });
    const first = await syncLeads(acme.token, { formId: '555' });
    expect(resultFor(first, '555')).toMatchObject({ status: 'partial', created: 6 });

    graph({ 'GET /555/leads': pagedLeads(withNewOnes, 3) });
    const second = await syncLeads(acme.token, { formId: '555' });

    expect(resultFor(second, '555')).toMatchObject({ status: 'ok', created: 1 });
    expect(await Lead.inWorkspace(acme.workspace.id).countDocuments()).toBe(10);
  });

  it('syncs every enabled form when none is named, skipping disabled and deleted ones', async () => {
    await patchForm(acme.token, '666', { syncEnabled: false });
    const { calls } = graph();

    const res = await syncLeads(acme.token);

    expect(res.body.results.map((result) => result.formId)).toEqual(['555']);
    expect(callsTo(calls, '/666/leads')).toHaveLength(0);

    await LeadForm.inWorkspace(acme.workspace.id).updateOne(
      { formId: '555' },
      { status: 'DELETED' },
    );
    expect((await syncLeads(acme.token)).body.results).toEqual([]);
  });

  it('syncs a named form even when bulk syncing is switched off for it', async () => {
    await patchForm(acme.token, '555', { syncEnabled: false });
    graph();

    const res = await syncLeads(acme.token, { formId: '555' });

    expect(resultFor(res, '555').created).toBe(5);
  });

  it('keeps going when one form fails, and records each form’s own outcome', async () => {
    graph({ 'GET /666/leads': graphError(403, { code: 200 }) });

    const res = await syncLeads(acme.token);

    expect(resultFor(res, '555')).toMatchObject({ status: 'ok', created: 5 });
    expect(resultFor(res, '666')).toMatchObject({ status: 'permission', created: 0 });
    expect(resultFor(res, '666').message).toMatch(/leads_retrieval/);
    const failed = await formOf(acme.workspace.id, '666');
    expect(failed).toMatchObject({ lastSyncStatus: 'permission', syncingSince: null });
    expect(failed.lastSyncedAt).toBeNull();
  });

  it('keeps what it got when Facebook starts rate limiting part-way', async () => {
    graph({
      'GET /555/leads': ({ params }) =>
        params.after ? graphError(400, { code: 4 }) : pagedLeads(FIVE, 3)({ params }),
    });

    const res = await syncLeads(acme.token, { formId: '555' });

    expect(resultFor(res, '555')).toMatchObject({ status: 'rate_limited', created: 3 });
    expect(await Lead.inWorkspace(acme.workspace.id).countDocuments()).toBe(3);
    expect(await formOf(acme.workspace.id, '555')).toMatchObject({
      backfillComplete: false,
      backfillCursor: 'C3',
      lastSyncStatus: 'rate_limited',
    });
  });

  it('marks the Page invalid when Facebook rejects its token mid-sync', async () => {
    graph({
      'GET /555/leads': graphError(400, { code: 190 }),
      'GET /debug_token': ({ params }) =>
        reply({
          data: params.input_token.startsWith('PAGE_TOKEN')
            ? pageTokenInfo({ is_valid: false, error: { code: 190, message: 'Token expired' } })
            : tokenInfo(),
        }),
    });

    const res = await syncLeads(acme.token, { formId: '555' });

    expect(resultFor(res, '555').status).toBe('invalid');
    expect(
      (await FacebookPage.inWorkspace(acme.workspace.id).findOne({ pageId: '111' })).status,
    ).toBe('invalid');
  });

  it('reports Facebook being unavailable without losing earlier state', async () => {
    graph({ 'GET /555/leads': graphError(500, { code: 2 }) });

    const res = await syncLeads(acme.token, { formId: '555' });

    expect(resultFor(res, '555')).toMatchObject({ status: 'error', created: 0 });
    expect(resultFor(res, '555').message).toMatch(/could not be reached/);
    expect(await formOf(acme.workspace.id, '555')).toMatchObject({
      backfillComplete: false,
      backfillCursor: null,
    });
  });

  it('retries with fewer fields when Facebook rejects the lead field list', async () => {
    const { calls } = graph({
      'GET /555/leads': ({ params }) =>
        params.fields.includes('is_organic')
          ? graphError(400, { code: 100, message: 'Unsupported field' })
          : pagedLeads(FIVE, 3)({ params }),
    });

    const res = await syncLeads(acme.token, { formId: '555' });

    expect(resultFor(res, '555')).toMatchObject({ status: 'ok', created: 5 });
    expect(callsTo(calls, '/555/leads')[0].params.fields).toContain('is_organic');
    expect(callsTo(calls, '/555/leads')[1].params.fields).not.toContain('is_organic');
  });

  it('skips a form whose Page has lost its token, without calling Facebook', async () => {
    await FacebookPage.inWorkspace(acme.workspace.id).updateOne(
      { pageId: '111' },
      { status: 'invalid', $unset: { pageTokenCipher: '' } },
    );
    const { calls } = graph();

    const res = await syncLeads(acme.token, { formId: '555' });

    expect(resultFor(res, '555')).toMatchObject({ status: 'invalid', created: 0 });
    expect(callsTo(calls, '/555/leads')).toHaveLength(0);
  });

  it('lets only one sync of a form run at a time', async () => {
    graph();

    const [first, second] = await Promise.all([
      syncLeads(acme.token, { formId: '555' }),
      syncLeads(acme.token, { formId: '555' }),
    ]);

    const statuses = [first, second].map((res) => resultFor(res, '555').status).sort();
    expect(statuses).toEqual(['busy', 'ok']);
    expect(await Lead.inWorkspace(acme.workspace.id).countDocuments()).toBe(5);
  });

  it('refuses while a fresh lock is held, but takes over a stale one', async () => {
    const lock = (secondsAgo) =>
      LeadForm.inWorkspace(acme.workspace.id).updateOne(
        { formId: '555' },
        { syncingSince: new Date(Date.now() - secondsAgo * 1000) },
      );

    await lock(30);
    const { calls } = graph();
    const busy = await syncLeads(acme.token, { formId: '555' });
    expect(resultFor(busy, '555').status).toBe('busy');
    expect(callsTo(calls, '/555/leads')).toHaveLength(0);

    await lock(10 * 60);
    const ok = await syncLeads(acme.token, { formId: '555' });
    expect(resultFor(ok, '555').status).toBe('ok');
  });

  it('keeps each workspace’s leads separate, even for the same Facebook lead ids', async () => {
    await syncLeads(acme.token);
    await syncLeads(globex.token);

    expect(await Lead.inWorkspace(acme.workspace.id).countDocuments()).toBe(5);
    expect(await Lead.inWorkspace(globex.workspace.id).countDocuments()).toBe(2);
    const ids = (await leadsOf(globex.workspace.id)).map((lead) => lead.facebookLeadId);
    expect(ids).toEqual(['lead-1', 'lead-2']);
  });

  it('rejects unknown, foreign and malformed targets, and members', async () => {
    const memberToken = await addMember(acme.workspace.id, 'member@acme.example', 'member');

    expect((await syncLeads(acme.token, { formId: '777' })).status).toBe(404);
    expect((await syncLeads(acme.token, { formId: '999' })).status).toBe(404);
    expect((await syncLeads(acme.token, { pageId: '333' })).status).toBe(404);
    expect((await syncLeads(acme.token, { formId: 'abc' })).status).toBe(400);
    expect((await syncLeads(memberToken)).status).toBe(403);
    expect((await request(app).post(`${API}/leads/sync`)).status).toBe(401);
  });

  it('works with no request body at all', async () => {
    const res = await request(app).post(`${API}/leads/sync`).set(bearer(acme.token));

    expect(res.status).toBe(200);
    expect(res.body.totals.created).toBe(5);
  });
});

describe('GET /leads and GET /leads/:leadId', () => {
  const SEVEN = numbered([1, 2, 3, 4, 5, 6, 7]);

  beforeEach(async () => {
    graph({ 'GET /555/leads': pagedLeads(SEVEN, 4) });
    await syncForms(acme.token);
    await syncForms(globex.token);
    await syncLeads(acme.token);
    await syncLeads(globex.token);
  });

  it('returns the newest leads first with paging details', async () => {
    const first = await listLeads(acme.token, { limit: 3 });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ total: 7, page: 1, limit: 3, totalPages: 3 });
    expect(first.body.leads.map((lead) => lead.facebookLeadId)).toEqual([
      'lead-1',
      'lead-2',
      'lead-3',
    ]);

    const last = await listLeads(acme.token, { limit: 3, page: 3 });
    expect(last.body.leads.map((lead) => lead.facebookLeadId)).toEqual(['lead-7']);

    const beyond = await listLeads(acme.token, { limit: 3, page: 9 });
    expect(beyond.body).toMatchObject({ leads: [], total: 7, totalPages: 3 });
  });

  it('never repeats or skips a lead across pages', async () => {
    const seen = [];
    for (const page of [1, 2, 3, 4]) {
      const res = await listLeads(acme.token, { limit: 2, page });
      seen.push(...res.body.leads.map((lead) => lead.facebookLeadId));
    }

    expect(seen).toEqual(['lead-1', 'lead-2', 'lead-3', 'lead-4', 'lead-5', 'lead-6', 'lead-7']);
  });

  it('defaults to the first page of 25', async () => {
    const res = await listLeads(acme.token);

    expect(res.body).toMatchObject({ page: 1, limit: 25, totalPages: 1 });
    expect(res.body.leads).toHaveLength(7);
  });

  it('filters by status, form and Page', async () => {
    await Lead.inWorkspace(acme.workspace.id).updateMany(
      { facebookLeadId: { $in: ['lead-2', 'lead-5'] } },
      { leadStatus: 'qualified' },
    );

    const qualified = await listLeads(acme.token, { status: 'qualified' });
    expect(qualified.body.total).toBe(2);
    expect(qualified.body.leads.map((lead) => lead.leadStatus)).toEqual(['qualified', 'qualified']);

    expect((await listLeads(acme.token, { formId: '555' })).body.total).toBe(7);
    expect((await listLeads(acme.token, { formId: '666' })).body.total).toBe(0);
    expect((await listLeads(acme.token, { pageId: '111', status: 'new' })).body.total).toBe(5);
    expect((await listLeads(acme.token, { pageId: '333' })).body.total).toBe(0);
  });

  it.each([
    ['a limit above 100', { limit: 101 }],
    ['page zero', { page: 0 }],
    ['a non-numeric page', { page: 'one' }],
    ['an unknown status', { status: 'bogus' }],
    ['a repeated status', { status: ['new', 'lost'] }],
    ['a non-numeric form id', { formId: 'abc' }],
  ])('rejects %s', async (_label, query) => {
    const res = await listLeads(acme.token, query);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('shows each lead’s details and never the original response', async () => {
    const res = await listLeads(acme.token, { limit: 1 });

    expect(res.body.leads[0]).toMatchObject({
      pageName: 'Acme Realty',
      formName: 'Spring Offer',
      fullName: 'Person 1',
      email: 'person1@example.com',
      phone: '+15550000001',
      customFields: [{ key: 'budget', value: '$500k' }],
      leadStatus: 'new',
      source: 'facebook_lead_ads',
      assignedTo: null,
      createdTime: '2026-10-31T11:59:00.000Z',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/rawPayload|v1\.|PAGE_TOKEN/);
  });

  it('is open to members but only shows the workspace’s own leads', async () => {
    const memberToken = await addMember(acme.workspace.id, 'member@acme.example', 'member');

    expect((await listLeads(memberToken)).body.total).toBe(7);
    expect((await listLeads(globex.token)).body.total).toBe(2);
    expect((await request(app).get(`${API}/leads`)).status).toBe(401);
  });

  it('returns one lead in full, and 404 for another workspace’s or a bad id', async () => {
    const acmeLead = await Lead.inWorkspace(acme.workspace.id).findOne({
      facebookLeadId: 'lead-1',
    });
    const globexLead = await Lead.inWorkspace(globex.workspace.id).findOne();
    const get = (token, id) => request(app).get(`${API}/leads/${id}`).set(bearer(token));

    const own = await get(acme.token, acmeLead.id);
    expect(own.status).toBe(200);
    expect(own.body.lead).toMatchObject({ id: acmeLead.id, fullName: 'Person 1' });

    expect((await get(acme.token, globexLead.id)).status).toBe(404);
    expect((await get(acme.token, '64b7f0c2a1b2c3d4e5f60718')).status).toBe(404);
    expect((await get(acme.token, 'nope')).status).toBe(404);
    expect((await get(acme.token, 'sync')).status).toBe(404);
  });
});

describe('forms and leads when a Page or connection is removed', () => {
  beforeEach(async () => {
    graph();
    await syncForms(acme.token);
    await syncLeads(acme.token);
  });

  it('removes a disconnected Page’s forms but keeps its leads', async () => {
    await request(app).delete(`${API}/facebook/pages/111`).set(bearer(acme.token));

    expect(await LeadForm.inWorkspace(acme.workspace.id).countDocuments()).toBe(0);
    const res = await listLeads(acme.token);
    expect(res.body.total).toBe(5);
    expect(res.body.leads[0]).toMatchObject({ pageName: 'Acme Realty', formName: 'Spring Offer' });
  });

  it('removes the forms of a disconnected Facebook account but keeps its leads', async () => {
    const page = await FacebookPage.inWorkspace(acme.workspace.id).findOne({ pageId: '111' });
    await request(app)
      .delete(`${API}/facebook/connections/${page.connectionId}`)
      .set(bearer(acme.token));

    expect(await LeadForm.inWorkspace(acme.workspace.id).countDocuments()).toBe(0);
    expect(await Lead.inWorkspace(acme.workspace.id).countDocuments()).toBe(5);
  });
});
