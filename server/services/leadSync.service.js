import { env } from '../config/env.js';
import { Lead } from '../models/Lead.js';
import { LeadForm } from '../models/LeadForm.js';
import { AppError } from '../utils/AppError.js';
import { verifyPage } from './facebookPage.service.js';
import { loadSyncablePages } from './leadForm.service.js';
import { mapLeadFields } from './leadMapper.js';
import { describeFailure } from './meta/failure.js';
import { listFormLeads, MetaApiError } from './meta/graphClient.js';
import { tokenCrypto } from './tokenCrypto.js';

const NUMERIC_ID = /^\d+$/;
const LOCK_TTL_MS = 5 * 60 * 1000;
const UPSERT_CHUNK = 25;

/** Binds an encrypted lead payload to its workspace and lead, so it cannot be moved elsewhere. */
export const leadPayloadAad = (workspaceId, facebookLeadId) =>
  `fb-lead-payload:${workspaceId}:${facebookLeadId}`;

/**
 * Stores a lead unless this workspace already has it. Existing leads are never touched, so a
 * re-sync cannot overwrite a status or assignment someone has since changed.
 * Returns true when the lead was new.
 */
export async function insertIfNew(workspaceId, form, pageName, raw) {
  const facebookLeadId = String(raw.id);
  const now = new Date();
  const createdTime =
    raw.created_time && !Number.isNaN(Date.parse(raw.created_time))
      ? new Date(raw.created_time)
      : now;

  try {
    const result = await Lead.inWorkspace(workspaceId).updateOne(
      { facebookLeadId },
      {
        $setOnInsert: {
          pageId: form.pageId,
          ...(pageName && { pageName }),
          formId: form.formId,
          ...(form.name && { formName: form.name }),
          ...mapLeadFields(raw.field_data),
          leadStatus: 'new',
          createdTime,
          source: raw.is_organic ? 'facebook_organic' : 'facebook_lead_ads',
          assignedTo: null,
          rawPayloadCipher: tokenCrypto.encrypt(
            JSON.stringify(raw),
            leadPayloadAad(workspaceId, facebookLeadId),
          ),
          syncedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      },
      // Timestamps are set by hand above so that matching an existing lead writes nothing.
      { upsert: true, timestamps: false },
    );
    return result.upsertedCount === 1;
  } catch (err) {
    // Two syncs reached the same lead at once; the unique index kept one.
    if (err.code === 11000) return false;
    throw err;
  }
}

async function storeLeads(workspaceId, form, pageName, leads) {
  let created = 0;
  for (let start = 0; start < leads.length; start += UPSERT_CHUNK) {
    const chunk = leads.slice(start, start + UPSERT_CHUNK);
    const results = await Promise.all(
      chunk.map((raw) => insertIfNew(workspaceId, form, pageName, raw)),
    );
    created += results.filter(Boolean).length;
  }
  return created;
}

/**
 * Reads a form's leads page by page. Facebook lists them newest first. Until a first full pass
 * has finished, every page is read and the position is saved so a later sync resumes there.
 * Afterwards a sync stops at the first page that holds nothing new.
 */
async function pullLeads(workspaceId, form, page, token) {
  const maxRequests = env.leadSync.maxRequestsPerForm;
  const catchingUp = form.backfillComplete;
  let cursor = catchingUp ? null : (form.backfillCursor ?? null);
  let requests = 0;
  let fetched = 0;
  let created = 0;
  let finished = false;
  let failure = null;

  while (!finished && !failure && requests < maxRequests) {
    try {
      const batch = await listFormLeads(form.formId, token, { after: cursor });
      requests += 1;
      fetched += batch.leads.length;

      const newLeads = await storeLeads(workspaceId, form, page.name, batch.leads);
      created += newLeads;

      if (!batch.nextCursor || (catchingUp && newLeads === 0)) finished = true;
      else cursor = batch.nextCursor;
    } catch (err) {
      if (!(err instanceof MetaApiError)) throw err;
      failure = describeFailure(err);
    }
  }

  return { requests, fetched, created, finished, failure, cursor };
}

async function syncOneForm(workspaceId, formRecord, page, token) {
  const scoped = LeadForm.inWorkspace(workspaceId);
  const summary = {
    formId: formRecord.formId,
    name: formRecord.name ?? null,
    pageId: formRecord.pageId,
    fetched: 0,
    created: 0,
  };

  // Only one sync per form at a time; a stale lock (a crashed run) expires on its own.
  const form = await scoped.findOneAndUpdate(
    {
      _id: formRecord._id,
      $or: [{ syncingSince: null }, { syncingSince: { $lt: new Date(Date.now() - LOCK_TTL_MS) } }],
    },
    { $set: { syncingSince: new Date() } },
    { returnDocument: 'after' },
  );
  if (!form) {
    return { ...summary, status: 'busy', message: 'A sync for this form is already running.' };
  }

  try {
    const pull = await pullLeads(workspaceId, form, page, token);
    summary.fetched = pull.fetched;
    summary.created = pull.created;

    const progress = pull.finished
      ? { backfillComplete: true, backfillCursor: null }
      : pull.requests > 0
        ? { backfillComplete: false, backfillCursor: pull.cursor }
        : {};

    let outcome = { status: 'ok', message: null };
    if (pull.failure) outcome = pull.failure;
    else if (!pull.finished) {
      outcome = {
        status: 'partial',
        message: 'More leads are waiting. Sync again to continue.',
      };
    }

    await scoped.updateOne(
      { _id: form._id },
      {
        $set: {
          ...progress,
          lastSyncStatus: outcome.status,
          lastSyncMessage: outcome.message,
          ...(!pull.failure && { lastSyncedAt: new Date() }),
        },
      },
    );

    if (outcome.status === 'invalid') await verifyPage(workspaceId, form.pageId).catch(() => null);
    return { ...summary, ...outcome };
  } finally {
    await scoped.updateOne({ _id: form._id }, { $set: { syncingSince: null } });
  }
}

/**
 * Pulls leads for every enabled form (or the one named). A failing form does not stop the others:
 * each form reports its own outcome. Re-running is safe, since leads are never stored twice.
 */
export async function syncLeads(workspaceId, { formId, pageId } = {}) {
  if (formId && !NUMERIC_ID.test(formId))
    throw new AppError(404, 'NOT_FOUND', 'Lead form not found');

  const candidates = await LeadForm.inWorkspace(workspaceId).find({
    ...(formId && { formId }),
    ...(pageId && { pageId }),
  });
  if (formId && candidates.length === 0)
    throw new AppError(404, 'NOT_FOUND', 'Lead form not found');

  // Asking for one form syncs it even if bulk syncing is switched off for it.
  const forms = candidates.filter(
    (form) => form.status !== 'DELETED' && (formId || form.syncEnabled),
  );
  const pages = new Map(
    (await loadSyncablePages(workspaceId, pageId)).map((entry) => [entry.page.pageId, entry]),
  );

  const results = [];
  for (const form of forms) {
    const entry = pages.get(form.pageId);
    if (!entry?.token) {
      results.push({
        formId: form.formId,
        name: form.name ?? null,
        pageId: form.pageId,
        fetched: 0,
        created: 0,
        status: 'invalid',
        message: 'This Page needs its Facebook connection renewed.',
      });
      continue;
    }
    results.push(await syncOneForm(workspaceId, form, entry.page, entry.token));
  }

  return {
    results,
    totals: {
      fetched: results.reduce((sum, result) => sum + result.fetched, 0),
      created: results.reduce((sum, result) => sum + result.created, 0),
    },
  };
}
