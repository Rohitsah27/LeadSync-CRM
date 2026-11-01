import { Lead } from '../models/Lead.js';
import { AppError } from '../utils/AppError.js';

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

/** A page of the workspace's leads, newest first. Filters narrow it; `total` counts the matches. */
export async function listLeads(workspaceId, { page, limit, status, formId, pageId }) {
  const filter = {
    ...(status && { leadStatus: status }),
    ...(formId && { formId }),
    ...(pageId && { pageId }),
  };
  const scoped = Lead.inWorkspace(workspaceId);

  const [leads, total] = await Promise.all([
    // The id breaks ties, so leads with the same timestamp never repeat or vanish between pages.
    scoped
      .find(filter)
      .sort({ createdTime: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    scoped.countDocuments(filter),
  ]);

  return { leads, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export async function getLead(workspaceId, leadId) {
  const lead = OBJECT_ID_HEX.test(leadId)
    ? await Lead.inWorkspace(workspaceId).findById(leadId)
    : null;
  if (!lead) throw new AppError(404, 'NOT_FOUND', 'Lead not found');
  return lead;
}
