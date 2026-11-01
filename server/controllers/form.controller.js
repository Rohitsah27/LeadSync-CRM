import { listForms, setFormSync, syncForms } from '../services/leadForm.service.js';
import { toPublicForm } from '../utils/serializers.js';

export async function showForms(req, res) {
  const forms = await listForms(req.workspaceId, req.validatedQuery);
  res.json({ forms: forms.map(({ form, storedLeads }) => toPublicForm(form, storedLeads)) });
}

/** Refreshes the forms from Facebook, then returns the stored list along with what happened. */
export async function refreshForms(req, res) {
  const results = await syncForms(req.workspaceId, req.body);
  const forms = await listForms(req.workspaceId, req.body);
  res.json({
    results,
    forms: forms.map(({ form, storedLeads }) => toPublicForm(form, storedLeads)),
  });
}

export async function updateForm(req, res) {
  const { form, storedLeads } = await setFormSync(req.workspaceId, req.params.formId, req.body);
  res.json({ form: toPublicForm(form, storedLeads) });
}
