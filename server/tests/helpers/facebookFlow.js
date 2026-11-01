import request from 'supertest';
import { env } from '../../config/env.js';
import { FacebookConnection } from '../../models/FacebookConnection.js';
import { User } from '../../models/User.js';
import { REQUIRED_SCOPES } from '../../services/meta/scopes.js';
import { hashPassword } from '../../services/password.service.js';
import { mockGraph, reply } from './graphMock.js';

export const API = '/api/v1';
export const FB_USER = '10001000100010';

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });
export const inDays = (days) => Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;

export const cookieFrom = (res, name) =>
  res.headers['set-cookie']
    ?.find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(';')[0]
    .slice(name.length + 1);

export const tokenInfo = (overrides = {}) => ({
  is_valid: true,
  app_id: env.meta.appId,
  user_id: FB_USER,
  scopes: [...REQUIRED_SCOPES, 'public_profile'],
  expires_at: inDays(60),
  data_access_expires_at: inDays(90),
  ...overrides,
});

/** What Facebook reports for a Page token: it never expires and has no user attached. */
export const pageTokenInfo = (overrides = {}) => ({
  is_valid: true,
  app_id: env.meta.appId,
  type: 'PAGE',
  scopes: [...REQUIRED_SCOPES],
  expires_at: 0,
  data_access_expires_at: inDays(90),
  ...overrides,
});

export const PAGES = [
  {
    id: '111',
    name: 'Acme Realty',
    category: 'Real Estate',
    tasks: ['ADVERTISE', 'MANAGE'],
    access_token: 'PAGE_TOKEN_111',
    picture: { data: { url: 'https://cdn.example/111.jpg' } },
  },
  {
    id: '222',
    name: 'Acme Autos',
    category: 'Car Dealership',
    tasks: ['CREATE_CONTENT'],
    access_token: 'PAGE_TOKEN_222',
    picture: { data: { url: 'https://cdn.example/222.jpg' } },
  },
  {
    id: '333',
    name: 'Acme Travel',
    category: 'Travel Agency',
    tasks: ['ADVERTISE'],
    access_token: 'PAGE_TOKEN_333',
    picture: { data: { url: 'https://cdn.example/333.jpg' } },
  },
];

const withoutToken = ({ access_token: _token, tasks: _tasks, ...details }) => details;

/** A Graph API where the Facebook login succeeds. Pass route overrides to break individual steps. */
export const graphRoutes = (overrides = {}) => ({
  'GET /oauth/access_token': ({ params }) =>
    params.grant_type === 'fb_exchange_token'
      ? reply({ access_token: 'LONG_TOKEN', token_type: 'bearer', expires_in: 5184000 })
      : reply({ access_token: 'SHORT_TOKEN', token_type: 'bearer' }),
  'GET /debug_token': ({ params }) =>
    reply({
      data: params.input_token.startsWith('PAGE_TOKEN') ? pageTokenInfo() : tokenInfo(),
    }),
  'GET /me': () => reply({ id: FB_USER, name: 'Fiona Business' }),
  [`DELETE /${FB_USER}/permissions`]: reply({ success: true }),
  ...overrides,
});

/** Subscribing, unsubscribing and checking new-lead notifications for each fake Page. */
const subscriptionRoutes = () =>
  Object.fromEntries(
    PAGES.flatMap(({ id }) => [
      [`POST /${id}/subscribed_apps`, reply({ success: true })],
      [`DELETE /${id}/subscribed_apps`, reply({ success: true })],
      [
        `GET /${id}/subscribed_apps`,
        reply({ data: [{ id: env.meta.appId, subscribed_fields: ['leadgen'] }] }),
      ],
    ]),
  );

/** Three Pages split over two result pages, so pagination is exercised. */
export const pageRoutes = (overrides = {}) => ({
  'GET /me/accounts': ({ params }) =>
    params.after === 'CURSOR1'
      ? reply({ data: [PAGES[1], PAGES[2]] })
      : reply({
          data: [PAGES[0]],
          paging: { cursors: { after: 'CURSOR1' }, next: 'https://graph.facebook.com/next' },
        }),
  'GET /111': reply(withoutToken(PAGES[0])),
  'GET /222': reply(withoutToken(PAGES[1])),
  'GET /333': reply(withoutToken(PAGES[2])),
  ...subscriptionRoutes(),
  ...overrides,
});

export const FORMS = [
  {
    id: '555',
    name: 'Spring Offer',
    status: 'ACTIVE',
    locale: 'en_US',
    leads_count: 8,
    created_time: '2026-09-01T00:00:00+0000',
    questions: [
      { key: 'full_name', label: 'Full name', type: 'FULL_NAME' },
      { key: 'email', label: 'Email', type: 'EMAIL' },
    ],
  },
  {
    id: '666',
    name: 'Old Promo',
    status: 'ARCHIVED',
    locale: 'en_US',
    leads_count: 2,
    created_time: '2026-01-01T00:00:00+0000',
    questions: [],
  },
];

/** A lead as Facebook returns it. Lower numbers are newer, matching Facebook's newest-first order. */
export const makeLead = (number, overrides = {}) => ({
  id: `lead-${number}`,
  created_time: new Date(Date.UTC(2026, 9, 31, 12, 0, 0) - number * 60_000)
    .toISOString()
    .replace('.000Z', '+0000'),
  form_id: '555',
  is_organic: false,
  field_data: [
    { name: 'full_name', values: [`Person ${number}`] },
    { name: 'email', values: [`person${number}@example.com`] },
    { name: 'phone_number', values: [`+1555000${String(number).padStart(4, '0')}`] },
    { name: 'budget', values: ['$500k'] },
  ],
  ...overrides,
});

/** Serves `leads` a few at a time, with Facebook-style cursors (`C3` means "start at the 4th"). */
export function pagedLeads(leads, perPage) {
  return ({ params }) => {
    const start = params.after ? Number(params.after.slice(1)) : 0;
    const next = start + perPage;
    return reply({
      data: leads.slice(start, next),
      ...(next < leads.length && {
        paging: { cursors: { after: `C${next}` }, next: 'https://graph.facebook.com/next' },
      }),
    });
  };
}

/** Helpers that drive the real HTTP API for one app instance. */
export function createFlow(app) {
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

  /** Runs a full Facebook login for an account and returns the callback response. */
  async function completeLogin(account) {
    const flow = await startConnect(account.token);
    return callback({ state: flow.state, cookie: flow.cookie, code: 'AUTH_CODE' });
  }

  /** Connects an account's Facebook and one Page. Returns the new connection's id. */
  async function connectPageFor(account, pageId = '111') {
    mockGraph(graphRoutes(pageRoutes()));
    await completeLogin(account);
    const connection = await FacebookConnection.inWorkspace(account.workspace.id).findOne();
    const connectionId = String(connection._id);
    await request(app)
      .post(`${API}/facebook/pages`)
      .set(bearer(account.token))
      .send({ connectionId, pageId });
    return connectionId;
  }

  return { signUp, addMember, startConnect, callback, completeLogin, connectPageFor };
}
