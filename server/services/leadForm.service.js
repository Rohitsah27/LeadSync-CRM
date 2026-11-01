import mongoose from 'mongoose';
import { FacebookPage } from '../models/FacebookPage.js';
import { Lead } from '../models/Lead.js';
import { LeadForm } from '../models/LeadForm.js';
import { AppError } from '../utils/AppError.js';
import { pageTokenAad, verifyPage } from './facebookPage.service.js';
import { describeFailure } from './meta/failure.js';
import { listLeadForms, MetaApiError } from './meta/graphClient.js';
import { tokenCrypto } from './tokenCrypto.js';

const NUMERIC_ID = /^\d+$/;
const MAX_FORM_REQUESTS = 10;

/** The workspace's Pages with their decrypted tokens (null when a Page has lost its token). */
export async function loadSyncablePages(workspaceId, pageId) {
  const pages = await FacebookPage.inWorkspace(workspaceId)
    .find(pageId ? { pageId } : {})
    .select('+pageTokenCipher');
  if (pageId && pages.length === 0) throw new AppError(404, 'NOT_FOUND', 'Facebook Page not found');

  return pages.map((page) => ({
    page,
    token:
      page.status === 'active' && page.pageTokenCipher
        ? tokenCrypto.decrypt(page.pageTokenCipher, pageTokenAad(workspaceId, page.pageId))
        : null,
  }));
}

async function fetchAllForms(pageId, token) {
  const forms = [];
  let after;

  for (let request = 0; request < MAX_FORM_REQUESTS; request += 1) {
    const batch = await listLeadForms(pageId, token, { after });
    forms.push(...batch.forms);
    after = batch.nextCursor;
    if (!after) return { forms, complete: true };
  }
  return { forms, complete: false };
}

const compact = (values) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value != null));

async function storeForms(workspaceId, pageId, { forms, complete }) {
  const scoped = LeadForm.inWorkspace(workspaceId);

  for (const form of forms) {
    await scoped.updateOne(
      { formId: form.formId },
      {
        $set: compact({
          pageId,
          name: form.name,
          status: form.status,
          locale: form.locale,
          questions: form.questions,
          facebookLeadsCount: form.facebookLeadsCount,
          facebookCreatedTime: form.facebookCreatedTime,
        }),
      },
      { upsert: true },
    );
  }

  // Only a complete listing can say a form is gone; a truncated one would delete real forms.
  if (complete) {
    await scoped.updateMany(
      { pageId, formId: { $nin: forms.map((form) => form.formId) } },
      { $set: { status: 'DELETED' } },
    );
  }
}

/** Refreshes the Lead Ads forms of one Page, or of every Page the workspace has connected. */
export async function syncForms(workspaceId, { pageId } = {}) {
  const results = [];

  for (const { page, token } of await loadSyncablePages(workspaceId, pageId)) {
    const base = { pageId: page.pageId, name: page.name ?? null };
    if (!token) {
      results.push({
        ...base,
        status: 'invalid',
        message: 'This Page needs its Facebook connection renewed.',
        forms: 0,
      });
      continue;
    }

    try {
      const listing = await fetchAllForms(page.pageId, token);
      await storeForms(workspaceId, page.pageId, listing);
      results.push({ ...base, status: 'ok', message: null, forms: listing.forms.length });
    } catch (err) {
      if (!(err instanceof MetaApiError)) throw err;
      const failure = describeFailure(err);
      if (failure.status === 'invalid')
        await verifyPage(workspaceId, page.pageId).catch(() => null);
      results.push({ ...base, ...failure, forms: 0 });
    }
  }

  return results;
}

/** Forms with how many of their leads are stored here, as opposed to Facebook's own count. */
export async function listForms(workspaceId, { pageId } = {}) {
  const forms = await LeadForm.inWorkspace(workspaceId)
    .find(pageId ? { pageId } : {})
    .sort({ pageId: 1, name: 1 });

  const counts = await Lead.aggregate([
    {
      $match: {
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        formId: { $in: forms.map((form) => form.formId) },
      },
    },
    { $group: { _id: '$formId', count: { $sum: 1 } } },
  ]);
  const stored = new Map(counts.map(({ _id, count }) => [_id, count]));

  return forms.map((form) => ({ form, storedLeads: stored.get(form.formId) ?? 0 }));
}

export async function setFormSync(workspaceId, formId, { syncEnabled }) {
  const form = NUMERIC_ID.test(formId)
    ? await LeadForm.inWorkspace(workspaceId).findOneAndUpdate(
        { formId },
        { $set: { syncEnabled } },
        { returnDocument: 'after' },
      )
    : null;
  if (!form) throw new AppError(404, 'NOT_FOUND', 'Lead form not found');

  const storedLeads = await Lead.inWorkspace(workspaceId).countDocuments({ formId });
  return { form, storedLeads };
}
