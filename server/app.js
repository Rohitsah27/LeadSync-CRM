import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';
import healthRoutes from './routes/health.routes.js';
import apiRoutes from './routes/index.js';
import { logger } from './utils/logger.js';
import metaWebhookRoutes from './webhooks/meta.routes.js';

export function createApp() {
  const app = express();
  const allowedOrigins = new Set(env.frontendOrigins);

  app.set('trust proxy', env.trustProxy);

  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/health' },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        return res.statusCode >= 400 ? 'warn' : 'info';
      },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  // Runs before every route, so preflight (OPTIONS) requests are answered here with a 204 and never
  // reach authentication or the rate limiter.
  app.use(
    cors({
      // Requests without an Origin header (curl, server-to-server, Meta webhooks) are not browser CORS requests.
      // A browser origin must match FRONTEND_URL exactly. The refresh cookie needs `credentials`,
      // and browsers refuse a wildcard origin together with credentials, so there is no wildcard.
      origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
      maxAge: 600,
    }),
  );
  // Meta signs the exact bytes it sends, so its webhook reads the raw body and has to come before
  // the JSON parser. It authenticates by signature, so the per-IP API rate limit does not apply.
  app.use('/api/v1/webhooks/meta', metaWebhookRoutes);

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/health', healthRoutes);
  app.use('/api/v1', apiLimiter, apiRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
