import { api } from './api.js';

export async function updateWorkspace(values) {
  const { data } = await api.patch('/workspace', values);
  return data.workspace;
}

export async function fetchMembers() {
  const { data } = await api.get('/workspace/members');
  return data.members;
}
