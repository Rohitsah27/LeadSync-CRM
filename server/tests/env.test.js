import { describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env.js';

const base = {
  FRONTEND_URL: 'https://app.example.com',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/leadsync',
  JWT_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv({ ...base });

    expect(env).toMatchObject({
      nodeEnv: 'development',
      port: 5000,
      logLevel: 'info',
      trustProxy: 0,
      rateLimit: { windowMs: 900000, max: 300 },
      mongodbUri: base.MONGODB_URI,
      auth: {
        accessTokenTtlSeconds: 900,
        refreshTokenTtlDays: 7,
        bcryptRounds: 12,
        cookieSameSite: 'lax',
        cookieSecure: false,
        rateLimitMax: 20,
      },
    });
  });

  it('requires the database URI and a strong JWT secret', () => {
    expect(() => parseEnv({ FRONTEND_URL: base.FRONTEND_URL })).toThrow(/MONGODB_URI: is required/);
    expect(() => parseEnv({ ...base, MONGODB_URI: 'postgres://localhost/db' })).toThrow(
      /must start with mongodb/,
    );
    expect(() => parseEnv({ ...base, JWT_SECRET: 'too-short' })).toThrow(
      /JWT_SECRET: must be at least 32 characters/,
    );
  });

  it('uses secure cross-site cookies in production only', () => {
    const production = parseEnv({ ...base, NODE_ENV: 'production' });

    expect(production.auth).toMatchObject({ cookieSameSite: 'none', cookieSecure: true });
    expect(() => parseEnv({ ...base, REFRESH_COOKIE_SAMESITE: 'none' })).toThrow(/requires https/);
    expect(parseEnv({ ...base, REFRESH_COOKIE_SAMESITE: 'strict' }).auth.cookieSameSite).toBe(
      'strict',
    );
  });

  it('enforces a minimum bcrypt cost in production', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', BCRYPT_ROUNDS: '8' })).toThrow(
      /BCRYPT_ROUNDS: must be at least 10/,
    );
    expect(parseEnv({ ...base, BCRYPT_ROUNDS: '4' }).auth.bcryptRounds).toBe(4);
  });

  it('requires FRONTEND_URL', () => {
    expect(() => parseEnv({})).toThrow(/FRONTEND_URL: is required/);
  });

  it('normalizes a comma-separated origin list', () => {
    const env = parseEnv({
      ...base,
      FRONTEND_URL: 'https://a.example.com/, https://b.example.com/dashboard',
    });

    expect(env.frontendOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('rejects an invalid origin', () => {
    expect(() => parseEnv({ FRONTEND_URL: 'not a url' })).toThrow(/not a valid URL/);
  });

  it('treats blank values as unset', () => {
    const env = parseEnv({ ...base, PORT: '', LOG_LEVEL: '', TRUST_PROXY: '' });

    expect(env.port).toBe(5000);
    expect(env.logLevel).toBe('info');
  });

  it('rejects out-of-range values', () => {
    expect(() => parseEnv({ ...base, PORT: '70000' })).toThrow(/PORT/);
    expect(() => parseEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('is silent under test and trusts one proxy hop in production', () => {
    expect(parseEnv({ ...base, NODE_ENV: 'test' }).logLevel).toBe('silent');
    expect(parseEnv({ ...base, NODE_ENV: 'production' }).trustProxy).toBe(1);
  });

  it('requires https origins in production', () => {
    expect(() =>
      parseEnv({ ...base, FRONTEND_URL: 'http://app.example.com', NODE_ENV: 'production' }),
    ).toThrow(/must use https in production/);
  });
});
