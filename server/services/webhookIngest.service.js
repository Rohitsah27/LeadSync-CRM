import { FacebookPage } from '../models/FacebookPage.js';
import { WebhookEvent } from '../models/WebhookEvent.js';

const MAX_CHANGES_PER_REQUEST = 1000;
const NUMERIC_ID = /^\d{1,32}$/;

/** A Facebook id as a string. Numbers are accepted only when they are exact. */
function idOf(value) {
  if (typeof value === 'string' && NUMERIC_ID.test(value)) return value;
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function dateOf(unixSeconds) {
  const seconds = Number(unixSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

/**
 * The new-lead changes in a Meta webhook payload. Everything else (other objects, other fields,
 * malformed or self-contradicting entries) is skipped rather than rejected, so one odd item never
 * makes Meta retry a whole batch.
 */
export function extractLeadgenChanges(payload) {
  if (payload?.object !== 'page' || !Array.isArray(payload.entry)) return [];

  const changes = [];
  for (const entry of payload.entry) {
    if (!Array.isArray(entry?.changes)) continue;

    for (const change of entry.changes) {
      const value = change?.value;
      if (change?.field !== 'leadgen' || !value || typeof value !== 'object') continue;

      const leadgenId = idOf(value.leadgen_id);
      const entryPageId = idOf(entry.id);
      const valuePageId = idOf(value.page_id);
      const pageId = valuePageId ?? entryPageId;
      const contradictory = valuePageId && entryPageId && valuePageId !== entryPageId;
      if (!leadgenId || !pageId || contradictory) continue;

      changes.push({
        leadgenId,
        pageId,
        formId: idOf(value.form_id),
        adId: idOf(value.ad_id),
        leadCreatedTime: dateOf(value.created_time),
      });
      if (changes.length >= MAX_CHANGES_PER_REQUEST) return changes;
    }
  }
  return changes;
}

/**
 * Saves each change as a pending event in the workspace that owns its Page. Nothing here calls
 * Facebook, so it is fast enough to answer Meta immediately; the lead is fetched later.
 * Repeated deliveries of the same lead are stored once.
 */
export async function ingestLeadgenChanges(changes) {
  const summary = { received: 0, duplicates: 0, unknownPages: 0 };
  const workspaceByPage = new Map();

  for (const change of changes) {
    if (!workspaceByPage.has(change.pageId)) {
      // Cross-workspace by design: the Page id is all the event carries. That is safe because a
      // Page can belong to only one workspace at a time.
      const page = await FacebookPage.findOne({ pageId: change.pageId })
        .select('workspaceId')
        .unscoped();
      workspaceByPage.set(change.pageId, page?.workspaceId ?? null);
    }

    const workspaceId = workspaceByPage.get(change.pageId);
    if (!workspaceId) {
      // A Page we do not (or no longer) serve. There is nobody to give the lead to.
      summary.unknownPages += 1;
      continue;
    }

    const now = new Date();
    try {
      const result = await WebhookEvent.inWorkspace(workspaceId).updateOne(
        { leadgenId: change.leadgenId },
        {
          $setOnInsert: {
            pageId: change.pageId,
            formId: change.formId,
            adId: change.adId,
            leadCreatedTime: change.leadCreatedTime,
            status: 'pending',
            attempts: 0,
            nextAttemptAt: now,
            receivedAt: now,
          },
        },
        { upsert: true },
      );
      summary[result.upsertedCount === 1 ? 'received' : 'duplicates'] += 1;
    } catch (err) {
      // The same lead arrived twice at once; the unique index kept one.
      if (err.code !== 11000) throw err;
      summary.duplicates += 1;
    }
  }

  return summary;
}
