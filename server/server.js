import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

try {
  await connectDB();
} catch (err) {
  logger.fatal({ err: err.message }, 'Could not connect to MongoDB');
  process.exit(1);
}

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info({ port: env.port, env: env.nodeEnv }, 'LeadSync API listening');
});

// Keep connections open longer than the load balancer's idle timeout to avoid sporadic 502s.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  server.close(async (err) => {
    await disconnectDB().catch(() => {});
    process.exit(err ? 1 : 0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
