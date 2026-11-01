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
  app.use(
    cors({
      // Requests without an Origin header (curl, server-to-server, Meta webhooks) are not browser CORS requests.
      origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
      credentials: true,
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/health', healthRoutes);
  app.use('/api/v1', apiLimiter, apiRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
