import { z } from 'zod';
import { LEAD_STATUSES } from '../models/Lead.js';

const facebookId = z.string().regex(/^\d+$/, 'Invalid id');

export const listLeadsQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(LEAD_STATUSES).optional(),
  formId: facebookId.optional(),
  pageId: facebookId.optional(),
});

export const listFormsQuery = z.object({ pageId: facebookId.optional() });

// An absent body means "everything", so the defaults make `{}` valid.
export const syncFormsBody = z.object({ pageId: facebookId.optional() }).default({});

export const syncLeadsBody = z
  .object({ formId: facebookId.optional(), pageId: facebookId.optional() })
  .default({});

export const updateFormBody = z.object({
  syncEnabled: z.boolean({ error: 'syncEnabled must be true or false' }),
});
