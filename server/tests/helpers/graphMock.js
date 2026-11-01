import crypto from 'node:crypto';
import { vi } from 'vitest';

export const reply = (body, status = 200) => ({ status, body });

/** A Graph API error response, shaped like Meta's. */
export const graphError = (status, error) =>
  reply({ error: { message: 'Mock Graph error', fbtrace_id: 'TRACE123', ...error } }, status);

/**
 * Replaces global fetch with a fake Meta Graph API, so tests never reach Facebook.
 * Routes are keyed `"METHOD /path"` without the version prefix; each value is a reply or a
 * function `(call) => reply`. Every request is recorded in `calls`.
 */
export function mockGraph(routes) {
  const calls = [];

  const fetchMock = vi.fn(async (input, init = {}) => {
    const url = new URL(String(input));
    const call = {
      method: init.method ?? 'GET',
      path: url.pathname.replace(/^\/v\d+\.\d+/, ''),
      params: Object.fromEntries(url.searchParams),
      signal: init.signal,
    };
    calls.push(call);

    const route = routes[`${call.method} ${call.path}`];
    const result = typeof route === 'function' ? route(call) : route;
    const { status, body } =
      result ??
      reply({ error: { message: `Unmocked ${call.method} ${call.path}`, code: 100 } }, 404);

    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

/** Builds a `signed_request` as Meta sends to the deauthorize callback. */
export function signedRequest(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${signature}.${body}`;
}
