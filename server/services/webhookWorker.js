import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { processPendingEvents } from './webhookProcessor.service.js';

/**
 * Runs the webhook queue in the background: once at start (to pick up anything left from before a
 * restart), on a timer, and immediately when `wake()` is called after new events arrive.
 *
 * Only one run happens at a time. A wake-up during a run is folded into one more pass after it, and
 * `stop()` always waits for the run in progress, so shutting down never cuts a lead in half.
 */
export function createWebhookWorker({
  intervalMs = env.webhook.workerIntervalMs,
  run = processPendingEvents,
} = {}) {
  let stopped = true;
  let inFlight = null;
  let runAgain = false;
  let timer = null;

  function tick() {
    if (inFlight) {
      runAgain = true;
      return inFlight;
    }

    inFlight = (async () => {
      try {
        do {
          runAgain = false;
          await run();
        } while (runAgain && !stopped);
      } catch (err) {
        logger.error({ err }, 'Webhook worker run failed');
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function scheduleNext() {
    if (stopped) return;
    timer = setTimeout(async () => {
      await tick();
      scheduleNext();
    }, intervalMs);
    timer.unref();
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      tick();
      scheduleNext();
    },
    wake() {
      if (!stopped) tick();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
    },
    get isRunning() {
      return !stopped;
    },
  };
}

export const webhookWorker = createWebhookWorker();
