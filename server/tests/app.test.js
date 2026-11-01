import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

const app = createApp();
const allowedOrigin = 'https://app.leadsync.test';

describe('health endpoints', () => {
  it('GET /health returns ok with a request id and no framework banner', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'disconnected' });
    expect(typeof res.body.uptime).toBe('number');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('GET /api/v1/health returns ok', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('error handling', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('returns 400 INVALID_JSON for malformed bodies', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{bad json');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 413 for oversized bodies', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(200 * 1024) }));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('security headers and CORS', () => {
  it('sets helmet headers', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('allows the configured frontend origin with credentials', async () => {
    const res = await request(app).get('/health').set('Origin', allowedOrigin);

    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('exposes the request id header to browser code', async () => {
    const res = await request(app).get('/health').set('Origin', allowedOrigin);

    expect(res.headers['access-control-expose-headers']).toContain('X-Request-Id');
  });

  it('does not grant CORS access to other origins', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers preflight requests for the frontend origin', async () => {
    const res = await request(app)
      .options('/api/v1/health')
      .set('Origin', allowedOrigin)
      .set('Access-Control-Request-Method', 'GET');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
  });

  const preflight = (path, origin, method = 'POST', headers = 'authorization,content-type') =>
    request(app)
      .options(path)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', method)
      .set('Access-Control-Request-Headers', headers);

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])('preflights %s requests', async (method) => {
    const res = await preflight('/api/v1/leads', allowedOrigin, method);

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods'].split(',')).toEqual(
      expect.arrayContaining(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']),
    );
  });

  it('allows the Authorization and Content-Type headers, and no others', async () => {
    const res = await preflight('/api/v1/auth/login', allowedOrigin);

    expect(res.headers['access-control-allow-headers']).toBe('Authorization,Content-Type');
  });

  it('answers preflight before authentication, origin checks and rate limiting', async () => {
    for (const path of ['/api/v1/leads', '/api/v1/auth/refresh', '/api/v1/facebook/pages']) {
      const res = await preflight(path, allowedOrigin);

      expect(res.status, path).toBe(204);
      expect(res.headers['access-control-allow-origin'], path).toBe(allowedOrigin);
    }
  });

  it('never answers with a wildcard origin', async () => {
    const simple = await request(app).get('/health').set('Origin', allowedOrigin);
    const pre = await preflight('/api/v1/leads', allowedOrigin);

    expect(simple.headers['access-control-allow-origin']).not.toBe('*');
    expect(pre.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('tells caches that the answer depends on the Origin header', async () => {
    const res = await request(app).get('/health').set('Origin', allowedOrigin);

    expect(res.headers.vary).toMatch(/\bOrigin\b/);
  });

  it('keeps the CORS headers on error responses, so the browser shows the real error', async () => {
    const unauthorized = await request(app).get('/api/v1/leads').set('Origin', allowedOrigin);
    const missing = await request(app).get('/api/v1/nothing-here').set('Origin', allowedOrigin);

    expect(unauthorized.status).toBe(401);
    expect(missing.status).toBe(404);
    for (const res of [unauthorized, missing]) {
      expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    }
  });

  it.each([
    ['another scheme', 'http://app.leadsync.test'],
    ['a subdomain', 'https://www.app.leadsync.test'],
    ['a longer host', 'https://app.leadsync.test.evil.example'],
    ['another port', 'https://app.leadsync.test:8443'],
    ['a different site', 'https://evil.example'],
    ['the null origin', 'null'],
  ])('matches the origin exactly: refuses %s', async (_label, origin) => {
    const simple = await request(app).get('/health').set('Origin', origin);
    const pre = await preflight('/api/v1/leads', origin);

    for (const res of [simple, pre]) {
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    }
  });
});
