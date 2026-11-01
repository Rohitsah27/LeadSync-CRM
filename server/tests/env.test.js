import { describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env.js';

const base = {
  FRONTEND_URL: 'https://app.example.com',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/leadsync',
  JWT_SECRET: 'x'.repeat(32),
};

const key = Buffer.alloc(32, 9).toString('base64');
const otherKey = Buffer.alloc(32, 3).toString('base64');
// Facebook settings are mandatory in production, so production configs need them too.
const meta = {
  META_APP_ID: '1234567890',
  META_APP_SECRET: 'an-app-secret-long-enough',
  META_LOGIN_CONFIG_ID: '555666777',
  META_OAUTH_REDIRECT_URI: 'https://api.example.com/api/v1/facebook/oauth/callback',
  TOKEN_ENCRYPTION_KEY: key,
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

  describe('Facebook settings', () => {
    it('is optional outside production and reports no configuration', () => {
      const env = parseEnv({ ...base });

      expect(env.meta).toBeNull();
      expect(env.tokenEncryption).toBeNull();
    });

    it('builds the Meta config and a key ring when everything is set', () => {
      const env = parseEnv({
        ...base,
        ...meta,
        META_GRAPH_API_VERSION: 'v26.0',
        TOKEN_ENCRYPTION_KEY_PREVIOUS: `${otherKey}, `,
      });

      expect(env.meta).toEqual({
        appId: '1234567890',
        appSecret: 'an-app-secret-long-enough',
        graphVersion: 'v26.0',
        loginConfigId: '555666777',
        redirectUri: 'https://api.example.com/api/v1/facebook/oauth/callback',
      });
      expect(env.tokenEncryption.current).toEqual(Buffer.from(key, 'base64'));
      expect(env.tokenEncryption.previous).toEqual([Buffer.from(otherKey, 'base64')]);
      expect(parseEnv({ ...base, ...meta }).meta.graphVersion).toBe('v25.0');
    });

    it('rejects a half-configured integration and names what is missing', () => {
      const partial = { ...meta };
      delete partial.META_APP_SECRET;
      delete partial.TOKEN_ENCRYPTION_KEY;

      expect(() => parseEnv({ ...base, ...partial })).toThrow(/META_APP_SECRET: is required/);
      expect(() => parseEnv({ ...base, ...partial })).toThrow(/TOKEN_ENCRYPTION_KEY: is required/);
    });

    it('is mandatory in production, and the redirect must use https', () => {
      expect(() => parseEnv({ ...base, NODE_ENV: 'production' })).toThrow(
        /META_APP_ID: is required/,
      );
      expect(() =>
        parseEnv({
          ...base,
          ...meta,
          NODE_ENV: 'production',
          META_OAUTH_REDIRECT_URI: 'http://api.example.com/cb',
        }),
      ).toThrow(/META_OAUTH_REDIRECT_URI: must use https/);
      expect(parseEnv({ ...base, ...meta, NODE_ENV: 'production' }).meta).not.toBeNull();
    });

    it.each([
      [
        'a short encryption key',
        { TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') },
        /TOKEN_ENCRYPTION_KEY/,
      ],
      [
        'a non-base64 encryption key',
        { TOKEN_ENCRYPTION_KEY: 'not base64 at all!' },
        /TOKEN_ENCRYPTION_KEY/,
      ],
      [
        'a bad previous key',
        { TOKEN_ENCRYPTION_KEY_PREVIOUS: `${key},short` },
        /TOKEN_ENCRYPTION_KEY_PREVIOUS/,
      ],
      ['a non-numeric app id', { META_APP_ID: 'abc' }, /META_APP_ID: must be numeric/],
      ['a short app secret', { META_APP_SECRET: 'tiny' }, /META_APP_SECRET/],
      ['a malformed Graph version', { META_GRAPH_API_VERSION: '25' }, /META_GRAPH_API_VERSION/],
      [
        'an invalid redirect URI',
        { META_OAUTH_REDIRECT_URI: 'not a url' },
        /META_OAUTH_REDIRECT_URI/,
      ],
    ])('rejects %s', (_label, override, pattern) => {
      expect(() => parseEnv({ ...base, ...meta, ...override })).toThrow(pattern);
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
    const production = parseEnv({ ...base, ...meta, NODE_ENV: 'production' });

    expect(production.auth).toMatchObject({ cookieSameSite: 'none', cookieSecure: true });
    expect(() => parseEnv({ ...base, REFRESH_COOKIE_SAMESITE: 'none' })).toThrow(/requires https/);
    expect(parseEnv({ ...base, REFRESH_COOKIE_SAMESITE: 'strict' }).auth.cookieSameSite).toBe(
      'strict',
    );
  });

  it('enforces a minimum bcrypt cost in production', () => {
    expect(() =>
      parseEnv({ ...base, ...meta, NODE_ENV: 'production', BCRYPT_ROUNDS: '8' }),
    ).toThrow(/BCRYPT_ROUNDS: must be at least 10/);
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
    expect(parseEnv({ ...base, ...meta, NODE_ENV: 'production' }).trustProxy).toBe(1);
  });

  it('requires https origins in production', () => {
    expect(() =>
      parseEnv({
        ...base,
        ...meta,
        FRONTEND_URL: 'http://app.example.com',
        NODE_ENV: 'production',
      }),
    ).toThrow(/must use https in production/);
  });
});
