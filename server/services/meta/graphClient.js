import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';

const GRAPH_ORIGIN = 'https://graph.facebook.com';
const DIALOG_ORIGIN = 'https://www.facebook.com';
const TIMEOUT_MS = 10_000;

function classify({ httpStatus, code }) {
  if (code === 190 || code === 102) return 'auth';
  if (code === 10 || (code >= 200 && code <= 299)) return 'permission';
  if ([4, 17, 32, 613].includes(code) || (code >= 80000 && code <= 80014)) return 'rate_limit';
  if (code === 1 || code === 2 || !httpStatus || httpStatus >= 500) return 'unavailable';
  if (code === 100) return 'invalid_request';
  return 'unknown';
}

/** An error from Facebook, or from failing to reach it. `kind` groups Meta's many error codes. */
export class MetaApiError extends Error {
  constructor({ message, httpStatus = null, code = null, subcode = null, fbtraceId = null }) {
    super(message);
    this.name = 'MetaApiError';
    this.httpStatus = httpStatus;
    this.code = code;
    this.subcode = subcode;
    this.fbtraceId = fbtraceId;
    this.kind = classify({ httpStatus, code });
  }
}

function requireMeta() {
  if (!env.meta) {
    throw new AppError(503, 'FACEBOOK_NOT_CONFIGURED', 'Facebook integration is not configured');
  }
  return env.meta;
}

const appSecretProof = (token, appSecret) =>
  crypto.createHmac('sha256', appSecret).update(token).digest('hex');

/**
 * `token` is a user or Page token (sent with appsecret_proof); `appToken` is the app's own
 * `id|secret` credential. Tokens travel in the query string, as Meta documents, so URLs are
 * never logged: only the path and Meta's error identifiers are.
 */
async function graphRequest({ method = 'GET', path, params = {}, token, appToken }) {
  const { appSecret, graphVersion } = requireMeta();
  const url = new URL(`${GRAPH_ORIGIN}/${graphVersion}${path}`);

  for (const [key, value] of Object.entries(params)) {
    // null means "not set" too; String(null) would put the text "null" in the URL.
    if (value != null) url.searchParams.set(key, String(value));
  }
  if (token) {
    url.searchParams.set('access_token', token);
    url.searchParams.set('appsecret_proof', appSecretProof(token, appSecret));
  } else if (appToken) {
    url.searchParams.set('access_token', appToken);
  }

  // One deadline covers connecting and reading the body, and the timer never outlives the request.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  let body;
  try {
    response = await fetch(url, {
      method,
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    body = await response.json().catch(() => null);
  } catch {
    logger.warn({ path }, 'Could not reach the Meta Graph API');
    throw new MetaApiError({ message: 'Could not reach Facebook' });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok || body?.error) {
    const error = body?.error ?? {};
    const failure = new MetaApiError({
      message: error.message ?? `Facebook returned HTTP ${response.status}`,
      httpStatus: response.status,
      code: error.code,
      subcode: error.error_subcode,
      fbtraceId: error.fbtrace_id,
    });
    logger.warn(
      {
        path,
        httpStatus: response.status,
        code: failure.code,
        subcode: failure.subcode,
        fbtraceId: failure.fbtraceId,
      },
      'Meta Graph API error',
    );
    throw failure;
  }

  return body;
}

/** The Facebook Login for Business dialog. `config_id` replaces `scope`. */
export function buildDialogUrl(state) {
  const { appId, graphVersion, loginConfigId, redirectUri } = requireMeta();
  const url = new URL(`${DIALOG_ORIGIN}/${graphVersion}/dialog/oauth`);

  url.search = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    config_id: loginConfigId,
    response_type: 'code',
    override_default_response_type: 'true',
  }).toString();

  return url.toString();
}

export function exchangeCodeForToken(code) {
  const { appId, appSecret, redirectUri } = requireMeta();
  return graphRequest({
    path: '/oauth/access_token',
    params: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
  });
}

export function exchangeForLongLivedToken(shortLivedToken) {
  const { appId, appSecret } = requireMeta();
  return graphRequest({
    path: '/oauth/access_token',
    params: {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedToken,
    },
  });
}

export async function debugToken(inputToken) {
  const { appId, appSecret } = requireMeta();
  const body = await graphRequest({
    path: '/debug_token',
    params: { input_token: inputToken },
    appToken: `${appId}|${appSecret}`,
  });
  return body.data ?? {};
}

export function getProfile(token) {
  return graphRequest({ path: '/me', params: { fields: 'id,name' }, token });
}

const PAGE_DETAIL_FIELDS = 'id,name,category,picture.type(large){url}';
const MAX_PAGE_REQUESTS = 10;

function normalizePage(page) {
  return {
    pageId: String(page.id),
    name: page.name ?? null,
    category: page.category ?? null,
    pictureUrl: page.picture?.data?.url ?? null,
    // `null` means Facebook did not say, which is different from an empty list.
    tasks: Array.isArray(page.tasks) ? page.tasks : null,
    accessToken: page.access_token ?? null,
  };
}

/** Every Page the token's user manages, following Facebook's pagination. Includes Page tokens. */
export async function listManagedPages(userToken) {
  const pages = [];
  let after;

  for (let request = 0; request < MAX_PAGE_REQUESTS; request += 1) {
    const body = await graphRequest({
      path: '/me/accounts',
      token: userToken,
      params: { fields: `${PAGE_DETAIL_FIELDS},tasks,access_token`, limit: 100, after },
    });
    pages.push(...(body.data ?? []).map(normalizePage));

    after = body.paging?.next ? body.paging.cursors?.after : undefined;
    if (!after) break;
  }

  return pages;
}

export async function getPageDetails(pageId, pageToken) {
  const body = await graphRequest({
    path: `/${encodeURIComponent(pageId)}`,
    token: pageToken,
    params: { fields: PAGE_DETAIL_FIELDS },
  });
  return normalizePage(body);
}

const FORM_FIELDS = ['id,name,status,locale,created_time,leads_count,questions', 'id,name,status'];
const LEAD_FIELDS = ['id,created_time,field_data,form_id,is_organic', 'id,created_time,field_data'];
const RESULTS_PER_REQUEST = 100;

/**
 * Reads one result page. If Facebook rejects the field list (code 100), it retries once with a
 * smaller one rather than failing the whole sync over an optional field.
 */
async function readEdge({ path, token, after, fieldSets }) {
  for (let attempt = 0; attempt < fieldSets.length; attempt += 1) {
    try {
      const body = await graphRequest({
        path,
        token,
        params: { fields: fieldSets[attempt], limit: RESULTS_PER_REQUEST, after },
      });
      return {
        items: body.data ?? [],
        nextCursor: body.paging?.next ? (body.paging.cursors?.after ?? null) : null,
      };
    } catch (err) {
      const canRetry = err instanceof MetaApiError && err.kind === 'invalid_request';
      if (!canRetry || attempt === fieldSets.length - 1) throw err;
    }
  }
  return { items: [], nextCursor: null };
}

function normalizeForm(form) {
  return {
    formId: String(form.id),
    name: form.name ?? null,
    status: form.status ?? null,
    locale: form.locale ?? null,
    facebookCreatedTime: form.created_time ? new Date(form.created_time) : null,
    facebookLeadsCount: Number.isInteger(form.leads_count) ? form.leads_count : null,
    questions: Array.isArray(form.questions)
      ? form.questions.slice(0, 100).map((question) => ({
          key: question.key ?? null,
          label: question.label ?? null,
          type: question.type ?? null,
        }))
      : [],
  };
}

/** One result page of a Page's Lead Ads forms. Needs the Page access token. */
export async function listLeadForms(pageId, pageToken, { after } = {}) {
  const { items, nextCursor } = await readEdge({
    path: `/${encodeURIComponent(pageId)}/leadgen_forms`,
    token: pageToken,
    after,
    fieldSets: FORM_FIELDS,
  });
  return { forms: items.filter((form) => form?.id).map(normalizeForm), nextCursor };
}

/** One result page of a form's leads, newest first, exactly as Facebook returns them. */
export async function listFormLeads(formId, pageToken, { after } = {}) {
  const { items, nextCursor } = await readEdge({
    path: `/${encodeURIComponent(formId)}/leads`,
    token: pageToken,
    after,
    fieldSets: LEAD_FIELDS,
  });
  return { leads: items.filter((lead) => lead?.id), nextCursor };
}

export function revokePermissions(facebookUserId, token) {
  return graphRequest({
    method: 'DELETE',
    path: `/${encodeURIComponent(facebookUserId)}/permissions`,
    token,
  });
}
