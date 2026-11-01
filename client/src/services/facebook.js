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

export async function fetchPages() {
  const { data } = await api.get('/facebook/pages');
  return data.pages;
}

/** Pages the connected Facebook account can manage, from Facebook itself. */
export async function fetchAvailablePages(connectionId) {
  const { data } = await api.get(`/facebook/connections/${connectionId}/pages`);
  return data.pages;
}

export async function connectPage({ connectionId, pageId }) {
  const { data } = await api.post('/facebook/pages', { connectionId, pageId });
  return data.page;
}

export async function recheckPage(pageId) {
  const { data } = await api.post(`/facebook/pages/${pageId}/check`);
  return data.page;
}

/** Asks Facebook to send this Page's new leads to the app. */
export async function subscribePage(pageId) {
  const { data } = await api.post(`/facebook/pages/${pageId}/subscription`);
  return data.page;
}

export async function disconnectPage(pageId) {
  await api.delete(`/facebook/pages/${pageId}`);
}

export async function disconnectConnection(connectionId) {
  await api.delete(`/facebook/connections/${connectionId}`);
}
