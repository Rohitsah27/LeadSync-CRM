import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { extractLeadgenChanges, ingestLeadgenChanges } from '../services/webhookIngest.service.js';
import { webhookWorker } from '../services/webhookWorker.js';
import { AppError } from '../utils/AppError.js';
import { isValidMetaSignature } from '../utils/webhookSignature.js';

// Meta's challenge is an integer. Anything else is not from Meta and must not be echoed back.
const SAFE_CHALLENGE = /^[A-Za-z0-9_-]{1,200}$/;

function sameToken(received, expected) {
  const left = Buffer.from(String(received ?? ''));
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Meta calls this once when the webhook is set up, to prove the URL is ours. */
export function verifyChallenge(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode !== 'subscribe' || !sameToken(token, env.meta.webhookVerifyToken)) {
    throw new AppError(403, 'FORBIDDEN', 'Webhook verification failed');
  }
  if (typeof challenge !== 'string' || !SAFE_CHALLENGE.test(challenge)) {
    throw new AppError(400, 'INVALID_CHALLENGE', 'Invalid challenge');
  }

  res.type('text/plain').send(challenge);
}

/**
 * Receives Meta's notifications. The signature is checked first; the events are saved and Meta gets
 * its answer straight away. Fetching the leads happens afterwards in the background worker, so a
 * slow Facebook never makes Meta time out and retry.
 */
export async function receive(req, res) {
  if (!Buffer.isBuffer(req.body)) {
    throw new AppError(400, 'INVALID_WEBHOOK', 'Expected a JSON body');
  }
  if (!isValidMetaSignature(req.body, req.get('x-hub-signature-256'), env.meta.appSecret)) {
    throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid webhook signature');
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  }

  const summary = await ingestLeadgenChanges(extractLeadgenChanges(payload));
  if (summary.received > 0) webhookWorker.wake();

  res.status(200).json(summary);
}
