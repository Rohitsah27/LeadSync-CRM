import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../middleware/errorHandler.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

describe('createRateLimiter', () => {
  it('returns a 429 JSON error once the limit is exceeded', async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, max: 2 }));
    app.get('/', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(200);

    const limited = await request(app).get('/');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});
