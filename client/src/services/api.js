import axios from 'axios';
import { API_URL } from '../utils/config.js';

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 15_000,
  headers: { Accept: 'application/json' },
});

// The access token lives only in memory. The refresh token is an httpOnly cookie that
// the browser manages and scripts cannot read.
let accessToken = null;
let refreshInFlight = null;
let sessionExpiredHandler = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function onSessionExpired(handler) {
  sessionExpiredHandler = handler;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestRefresh() {
  try {
    return (await api.post('/auth/refresh')).data;
  } catch (error) {
    if (error.response?.status !== 409) throw error;
    // Another tab rotated the cookie an instant ago; the browser now holds its new value.
    await wait(300);
    return (await api.post('/auth/refresh')).data;
  }
}

/** Concurrent callers share one request, because the refresh cookie rotates on every use. */
export function refreshSession() {
  refreshInFlight ??= requestRefresh()
    .then((data) => {
      accessToken = data.accessToken;
      return data;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

api.interceptors.response.use(undefined, async (error) => {
  const original = error.config;
  const unauthorized = error.response?.status === 401;

  // Auth routes report their own 401s (bad credentials, dead refresh token); retrying would loop.
  if (!unauthorized || !original || original._retried || original.url?.startsWith('/auth/')) {
    throw error;
  }
  original._retried = true;

  try {
    await refreshSession();
  } catch {
    accessToken = null;
    sessionExpiredHandler?.();
    throw error;
  }

  return api(original);
});
