import { api } from './api.js';

export async function fetchHealth({ signal } = {}) {
  const { data } = await api.get('/health', { signal });
  return data;
}
