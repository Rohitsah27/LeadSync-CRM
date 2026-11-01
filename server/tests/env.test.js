import { describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env.js';

const base = { FRONTEND_URL: 'https://app.example.com' };

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv({ ...base });

    expect(env).toMatchObject({
      nodeEnv: 'development',
      port: 5000,
      logLevel: 'info',
      trustProxy: 0,
      rateLimit: { windowMs: 900000, max: 300 },
    });
  });

  it('requires FRONTEND_URL', () => {
    expect(() => parseEnv({})).toThrow(/FRONTEND_URL: is required/);
  });

  it('normalizes a comma-separated origin list', () => {
    const env = parseEnv({
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
      parseEnv({ FRONTEND_URL: 'http://app.example.com', NODE_ENV: 'production' }),
    ).toThrow(/must use https in production/);
  });
});
