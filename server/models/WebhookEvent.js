import mongoose from 'mongoose';
import { tenantScope } from './plugins/tenantScope.js';

export const WEBHOOK_EVENT_STATUSES = [
  'pending',
  'processing',
  'retry',
  'processed',
  'ignored',
  'failed',
];

// One "new lead" notification from Meta. It is saved before anything else happens, so a restart
// cannot lose it, and it is keyed by Facebook's lead id, so a repeated delivery is stored once.
// Events carry ids only (no personal data); the lead itself is fetched when the event is processed.
const webhookEventSchema = new mongoose.Schema({
  leadgenId: { type: String, required: true },
  pageId: { type: String, required: true },
  formId: { type: String, default: null },
  adId: { type: String, default: null },
  leadCreatedTime: { type: Date, default: null },

  status: { type: String, enum: WEBHOOK_EVENT_STATUSES, default: 'pending' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, required: true },
  lockedAt: { type: Date, default: null },
  lastError: { type: String, maxlength: 500, default: null },
  result: { type: String, maxlength: 50, default: null },

  receivedAt: { type: Date, required: true },
  processedAt: { type: Date, default: null },
  // Finished events are deleted automatically after a while (see the TTL index below).
  expiresAt: { type: Date, default: null },
});

webhookEventSchema.plugin(tenantScope);
webhookEventSchema.index({ workspaceId: 1, leadgenId: 1 }, { unique: true });
// The background worker looks for the next event that is due.
webhookEventSchema.index({ status: 1, nextAttemptAt: 1 });
webhookEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);
