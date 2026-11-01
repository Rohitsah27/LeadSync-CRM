import { api, refreshSession, setAccessToken } from './api.js';

async function startSession(request) {
  const { data } = await request;
  setAccessToken(data.accessToken);
  return { user: data.user, workspace: data.workspace };
}

export const login = (credentials) => startSession(api.post('/auth/login', credentials));

export const register = (details) => startSession(api.post('/auth/register', details));

export const changePassword = (values) => startSession(api.post('/users/me/password', values));

/** Resumes a session from the refresh cookie, e.g. after a page reload. */
export async function restoreSession() {
  const { user, workspace } = await refreshSession();
  return { user, workspace };
}

export async function logout() {
  try {
    await api.post('/auth/logout');
  } finally {
    setAccessToken(null);
  }
}

export async function logoutAllDevices() {
  await api.post('/auth/logout-all');
  setAccessToken(null);
}

export async function updateProfile(values) {
  const { data } = await api.patch('/users/me', values);
  return data.user;
}
