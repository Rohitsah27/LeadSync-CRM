import { getLead, listLeads } from '../services/lead.service.js';
import { syncLeads } from '../services/leadSync.service.js';
import { toPublicLead } from '../utils/serializers.js';

export async function showLeads(req, res) {
  const { leads, ...paging } = await listLeads(req.workspaceId, req.validatedQuery);
  res.json({ leads: leads.map(toPublicLead), ...paging });
}

export async function showLead(req, res) {
  const lead = await getLead(req.workspaceId, req.params.leadId);
  res.json({ lead: toPublicLead(lead) });
}

export async function runLeadSync(req, res) {
  res.json(await syncLeads(req.workspaceId, req.body));
}
