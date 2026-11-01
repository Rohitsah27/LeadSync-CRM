import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, onSessionExpired, refreshSession, setAccessToken } from './api.js';

const originalAdapter = api.defaults.adapter;
const adapter = vi.fn();

function reply(config, status, data = {}) {
  const response = { data, status, statusText: String(status), headers: {}, config };
  if (status < 400) return Promise.resolve(response);
  return Promise.reject(
    new AxiosError(
      `Request failed with status code ${status}`,
      'ERR_BAD_REQUEST',
      config,
      null,
      response,
    ),
  );
}

const refreshCalls = () => adapter.mock.calls.filter(([config]) => config.url === '/auth/refresh');
const refreshed = { accessToken: 'new-token', user: { id: 'u1' }, workspace: { id: 'w1' } };

beforeEach(() => {
  adapter.mockReset();
  api.defaults.adapter = adapter;
  setAccessToken(null);
  onSessionExpired(null);
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

describe('access token handling', () => {
  it('sends the in-memory token as a Bearer header', async () => {
    adapter.mockImplementation((config) => reply(config, 200, {}));
    setAccessToken('abc');

    await api.get('/users/me');

    expect(adapter.mock.calls[0][0].headers.Authorization).toBe('Bearer abc');
  });

  it('sends no Authorization header when signed out', async () => {
    adapter.mockImplementation((config) => reply(config, 200, {}));

    await api.get('/health');

    expect(adapter.mock.calls[0][0].headers.Authorization).toBeUndefined();
  });
});

describe('401 recovery', () => {
  it('refreshes once and retries the request with the new token', async () => {
    setAccessToken('expired-token');
    adapter.mockImplementation((config) => {
      if (config.url === '/auth/refresh') return reply(config, 200, refreshed);
      return config.headers.Authorization === 'Bearer new-token'
        ? reply(config, 200, { ok: true })
        : reply(config, 401, { error: { code: 'TOKEN_EXPIRED' } });
    });

    const response = await api.get('/users/me');

    expect(response.data).toEqual({ ok: true });
    expect(refreshCalls()).toHaveLength(1);
  });

  it('shares one refresh between concurrent failing requests', async () => {
    setAccessToken('expired-token');
    adapter.mockImplementation((config) => {
      if (config.url === '/auth/refresh') return reply(config, 200, refreshed);
      return config.headers.Authorization === 'Bearer new-token'
        ? reply(config, 200, { ok: true })
        : reply(config, 401);
    });

    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);

    expect(refreshCalls()).toHaveLength(1);
  });

  it('reports an expired session when the refresh is rejected', async () => {
    const handler = vi.fn();
    onSessionExpired(handler);
    setAccessToken('expired-token');
    adapter.mockImplementation((config) => reply(config, 401, { error: { code: 'X' } }));

    await expect(api.get('/users/me')).rejects.toMatchObject({ response: { status: 401 } });

    expect(handler).toHaveBeenCalledTimes(1);
    adapter.mockImplementation((config) => reply(config, 200));
    await api.get('/health');
    expect(adapter.mock.calls.at(-1)[0].headers.Authorization).toBeUndefined();
  });

  it('gives up if the retried request is still unauthorized', async () => {
    setAccessToken('expired-token');
    adapter.mockImplementation((config) =>
      config.url === '/auth/refresh' ? reply(config, 200, refreshed) : reply(config, 401),
    );

    await expect(api.get('/users/me')).rejects.toMatchObject({ response: { status: 401 } });

    expect(refreshCalls()).toHaveLength(1);
  });

  it('does not try to refresh when the login endpoint itself returns 401', async () => {
    adapter.mockImplementation((config) =>
      reply(config, 401, { error: { code: 'INVALID_CREDENTIALS' } }),
    );

    await expect(api.post('/auth/login', {})).rejects.toMatchObject({ response: { status: 401 } });

    expect(refreshCalls()).toHaveLength(0);
  });

  it('does not refresh for non-auth failures', async () => {
    adapter.mockImplementation((config) => reply(config, 500));

    await expect(api.get('/users/me')).rejects.toMatchObject({ response: { status: 500 } });

    expect(refreshCalls()).toHaveLength(0);
  });
});

describe('refreshSession', () => {
  it('retries once when another tab rotated the cookie at the same moment', async () => {
    adapter
      .mockImplementationOnce((config) =>
        reply(config, 409, { error: { code: 'REFRESH_CONFLICT' } }),
      )
      .mockImplementationOnce((config) => reply(config, 200, refreshed));

    const data = await refreshSession();

    expect(data.accessToken).toBe('new-token');
    expect(refreshCalls()).toHaveLength(2);
  });
});
