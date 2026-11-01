import { env } from '../config/env.js';
import { FacebookPage } from '../models/FacebookPage.js';
import { logger } from '../utils/logger.js';
import { describeSubscriptionFailure } from './meta/failure.js';
import {
  getPageSubscriptions,
  MetaApiError,
  subscribePage,
  unsubscribePage,
} from './meta/graphClient.js';

const record = (workspaceId, pageId, fields) =>
  FacebookPage.inWorkspace(workspaceId).findOneAndUpdate(
    { pageId },
    { $set: fields },
    { returnDocument: 'after' },
  );

/**
 * Subscribes a Page to new-lead notifications and records the outcome on the Page. A refusal from
 * Facebook comes back as `error` instead of being thrown, because connecting a Page must not fail
 * over it: the admin can retry, and a manual sync still works without it.
 */
export async function subscribeToLeads(workspaceId, pageId, pageToken) {
  try {
    await subscribePage(pageId, pageToken);
  } catch (err) {
    if (!(err instanceof MetaApiError)) throw err;
    const error = describeSubscriptionFailure(err);
    const page = await record(workspaceId, pageId, {
      webhookSubscribed: false,
      webhookError: error.message,
    });
    return { page, error };
  }

  const page = await record(workspaceId, pageId, {
    webhookSubscribed: true,
    webhookSubscribedAt: new Date(),
    webhookError: null,
  });
  return { page, error: null };
}

/** Asks Facebook whether the Page is really subscribed, and makes the Page record match. */
export async function refreshSubscriptionState(workspaceId, pageId, pageToken) {
  let subscriptions;
  try {
    subscriptions = await getPageSubscriptions(pageId, pageToken);
  } catch (err) {
    if (!(err instanceof MetaApiError)) throw err;
    return null;
  }

  const subscribed = subscriptions.some(
    (app) => app.appId === env.meta.appId && app.fields.includes('leadgen'),
  );
  return record(workspaceId, pageId, {
    webhookSubscribed: subscribed,
    ...(subscribed && { webhookError: null }),
  });
}

/** Stops new-lead notifications for a Page. The token may already be dead, so failure is fine. */
export async function unsubscribeQuietly(pageId, pageToken) {
  try {
    await unsubscribePage(pageId, pageToken);
  } catch (err) {
    logger.info({ code: err.code ?? null }, 'Could not unsubscribe a Page from new leads');
  }
}
