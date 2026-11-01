import { api } from './api.js';

export async function fetchConnections() {
  const { data } = await api.get('/facebook/connections');
  return data;
}

/** Returns the Facebook login URL to send the browser to. */
export async function startConnect() {
  const { data } = await api.post('/facebook/connect');
  return data.authorizationUrl;
}

export async function recheckConnection(connectionId) {
  const { data } = await api.post(`/facebook/connections/${connectionId}/check`);
  return data.connection;
}

export async function disconnectConnection(connectionId) {
  await api.delete(`/facebook/connections/${connectionId}`);
}
