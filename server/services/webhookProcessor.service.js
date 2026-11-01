import { FacebookPage } from '../models/FacebookPage.js';
import { LeadForm } from '../models/LeadForm.js';
import { WebhookEvent } from '../models/WebhookEvent.js';
import { logger } from '../utils/logger.js';
import { verifyPage } from './facebookPage.service.js';
import { insertIfNew } from './leadSync.service.js';
import { syncForms } from './leadForm.service.js';
import { describeFailure } from './meta/failure.js';
import { getLead, MetaApiError } from './meta/graphClient.js';
import { pageTokenAad } from './tokenAad.js';
import { tokenCrypto } from './tokenCrypto.js';

const MAX_ATTEMPTS = 6;
// How long to wait after the 1st, 2nd, ... failed attempt.
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000, 3_600_000, 7_200_000];
// An event stuck in "processing" this long belongs to a worker that died.
const LOCK_TTL_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_FINISHED_DAYS = { processed: 30, ignored: 7, failed: 90 };

/** Takes the next event that is due. Atomic, so several workers or servers never share one. */
function claimNextEvent(now) {
  return WebhookEvent.findOneAndUpdate(
    {
      $or: [
        { status: { $in: ['pending', 'retry'] }, nextAttemptAt: { $lte: now } },
        { status: 'processing', lockedAt: { $lt: new Date(now.getTime() - LOCK_TTL_MS) } },
      ],
    },
    { $set: { status: 'processing', lockedAt: now }, $inc: { attempts: 1 } },
    { sort: { nextAttemptAt: 1 }, returnDocument: 'after' },
    // The queue is shared by every workspace; each claimed event then carries its own.
  ).unscoped();
}

const scoped = (event) => WebhookEvent.inWorkspace(event.workspaceId);

function finish(event, status, { message = null, result = null } = {}) {
  const now = new Date();
  return scoped(event).updateOne(
    { _id: event._id },
    {
      $set: {
        status,
        lastError: message,
        result,
        processedAt: now,
        lockedAt: null,
        expiresAt: new Date(now.getTime() + KEEP_FINISHED_DAYS[status] * DAY_MS),
      },
    },
  );
}

/** Puts the event back in the queue for a later attempt, or gives up after enough of them. */
function retryLater(event, message) {
  if (event.attempts >= MAX_ATTEMPTS) {
    return finish(event, 'failed', {
      message: `Gave up after ${event.attempts} attempts. ${message}`,
    });
  }

  const delay = RETRY_DELAYS_MS[Math.min(event.attempts, RETRY_DELAYS_MS.length) - 1];
  return scoped(event).updateOne(
    { _id: event._id },
    {
      $set: {
        status: 'retry',
        lastError: message,
        lockedAt: null,
        nextAttemptAt: new Date(Date.now() + delay),
      },
    },
  );
}

/** The form's record, loading the Page's forms from Facebook first if this one is new to us. */
async function findForm(workspaceId, pageId, formId) {
  if (!formId) return null;
  const forms = LeadForm.inWorkspace(workspaceId);

  let form = await forms.findOne({ formId });
  if (!form) {
    await syncForms(workspaceId, { pageId }).catch(() => null);
    form = await forms.findOne({ formId });
  }
  return form;
}

async function handleFailure(event, page, err) {
  const failure = describeFailure(err);

  // A temporary problem on Facebook's side is worth another try; anything else is not.
  if (err.kind === 'unavailable' || err.kind === 'rate_limit') {
    return retryLater(event, failure.message);
  }
  if (err.kind === 'auth') await verifyPage(event.workspaceId, page.pageId).catch(() => null);
  return finish(event, 'failed', { message: failure.message });
}

async function handle(event) {
  const { workspaceId } = event;

  const page = await FacebookPage.inWorkspace(workspaceId)
    .findOne({ pageId: event.pageId })
    .select('+pageTokenCipher');
  if (!page) return finish(event, 'ignored', { message: 'The Page is no longer connected.' });
  if (page.status !== 'active' || !page.pageTokenCipher) {
    return finish(event, 'failed', {
      message: 'This Page needs its Facebook connection renewed. A manual sync will catch up.',
    });
  }

  const token = tokenCrypto.decrypt(page.pageTokenCipher, pageTokenAad(workspaceId, page.pageId));

  let raw;
  try {
    raw = await getLead(event.leadgenId, token);
  } catch (err) {
    if (!(err instanceof MetaApiError)) throw err;
    return handleFailure(event, page, err);
  }

  const formId = String(raw.form_id ?? event.formId ?? '');
  const form = await findForm(workspaceId, page.pageId, formId);
  if (form && !form.syncEnabled) {
    return finish(event, 'ignored', { message: 'The form is not included in automatic sync.' });
  }

  const created = await insertIfNew(
    workspaceId,
    { pageId: page.pageId, formId, name: form?.name },
    page.name,
    raw,
  );
  await FacebookPage.inWorkspace(workspaceId).updateOne(
    { _id: page._id },
    { $set: { lastWebhookAt: new Date() } },
  );

  return finish(event, 'processed', { result: created ? 'created' : 'duplicate' });
}

async function processClaimed(event) {
  try {
    await handle(event);
  } catch (err) {
    logger.error(
      { err, leadgenId: event.leadgenId },
      'Unexpected error processing a webhook event',
    );
    await retryLater(event, 'An unexpected error occurred.');
  }
}

/** Works through the events that are due. Returns how many it handled. */
export async function processPendingEvents({ limit = 50, now = () => new Date() } = {}) {
  let handled = 0;

  while (handled < limit) {
    const event = await claimNextEvent(now());
    if (!event) break;
    await processClaimed(event);
    handled += 1;
  }
  return handled;
}
