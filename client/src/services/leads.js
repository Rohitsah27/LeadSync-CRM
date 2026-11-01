import { api } from './api.js';

export async function fetchForms() {
  const { data } = await api.get('/forms');
  return data.forms;
}

/** Asks Facebook for the Pages' current forms. Resolves `{ results, forms }`. */
export async function refreshForms(body = {}) {
  const { data } = await api.post('/forms/sync', body);
  return data;
}

export async function updateForm(formId, values) {
  const { data } = await api.patch(`/forms/${formId}`, values);
  return data.form;
}

/** Pulls leads from Facebook. Resolves `{ results, totals }`, one result per form. */
export async function syncLeads(body = {}) {
  const { data } = await api.post('/leads/sync', body);
  return data;
}

/** One page of leads. Resolves `{ leads, total, page, limit, totalPages }`. */
export async function fetchLeads(params) {
  const { data } = await api.get('/leads', { params });
  return data;
}

export async function fetchLead(leadId) {
  const { data } = await api.get(`/leads/${leadId}`);
  return data.lead;
}
