import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const originList = z
  .string({ error: 'is required' })
  .min(1, 'is required')
  .transform((value, ctx) => {
    const origins = [];
    for (const raw of value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)) {
      try {
        origins.push(new URL(raw).origin);
      } catch {
        ctx.addIssue({ code: 'custom', message: `"${raw}" is not a valid URL` });
        return z.NEVER;
      }
    }
    return origins;
  });

const mongoUri = z
  .string({ error: 'is required' })
  .min(1, 'is required')
  .refine(
    (value) => /^mongodb(\+srv)?:\/\//.test(value),
    'must start with mongodb:// or mongodb+srv://',
  );

function isValidKey(value) {
  const key = Buffer.from(value, 'base64');
  return key.length === 32 && key.toString('base64') === value;
}

const keyMessage = 'must be 32 random bytes, base64-encoded';
const numericId = z.string().regex(/^\d+$/, 'must be numeric');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  FRONTEND_URL: originList,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  MONGODB_URI: mongoUri,
  JWT_SECRET: z.string({ error: 'is required' }).min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  REFRESH_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).optional(),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  // Each Facebook request returns up to 100 leads, so a sync handles at most 100 x this per form
  // before it stops and resumes on the next run. This keeps a request short and polite to Meta.
  LEAD_SYNC_MAX_REQUESTS_PER_FORM: z.coerce.number().int().min(1).max(100).default(10),
  // How often the background worker looks for webhook events that are due (new, or retrying).
  WEBHOOK_WORKER_INTERVAL_MS: z.coerce.number().int().min(100).max(300_000).default(10_000),
  META_APP_ID: numericId.optional(),
  META_APP_SECRET: z.string().min(16, 'looks too short to be an app secret').optional(),
  META_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, 'must look like v25.0')
    .default('v25.0'),
  META_LOGIN_CONFIG_ID: numericId.optional(),
  META_OAUTH_REDIRECT_URI: z.url('must be a valid URL').optional(),
  // The secret Meta sends back when it checks the webhook URL. Any long random string.
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(16, 'must be at least 16 characters').optional(),
  TOKEN_ENCRYPTION_KEY: z.string().refine(isValidKey, keyMessage).optional(),
  // Retired keys, comma-separated. They can still decrypt old data while it is re-encrypted.
  TOKEN_ENCRYPTION_KEY_PREVIOUS: z
    .string()
    .refine(
      (value) =>
        value
          .split(',')
          .map((key) => key.trim())
          .filter(Boolean)
          .every(isValidKey),
      `each key ${keyMessage}`,
    )
    .optional(),
});

function fail(lines) {
  throw new Error(`Invalid environment configuration:\n${lines.map((l) => `  - ${l}`).join('\n')}`);
}

/**
 * Validates raw environment variables and returns the typed config.
 * Blank values (e.g. `PORT=` copied from .env.example) are treated as unset.
 */
export function parseEnv(source = process.env) {
  const provided = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = schema.safeParse(provided);

  if (!result.success) {
    fail(result.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`));
  }

  const data = result.data;
  const nodeEnv = data.NODE_ENV;
  const isProduction = nodeEnv === 'production';
  const problems = [];

  if (isProduction && data.FRONTEND_URL.some((origin) => !origin.startsWith('https://'))) {
    problems.push('FRONTEND_URL: must use https in production');
  }
  if (isProduction && data.BCRYPT_ROUNDS < 10) {
    problems.push('BCRYPT_ROUNDS: must be at least 10 in production');
  }
  if (!isProduction && data.REFRESH_COOKIE_SAMESITE === 'none') {
    problems.push(
      'REFRESH_COOKIE_SAMESITE: "none" requires https, so it is only allowed in production',
    );
  }

  // Facebook login is all-or-nothing: a half-configured integration should fail at startup,
  // not on a user's first click. It is mandatory in production.
  const metaSettings = {
    META_APP_ID: data.META_APP_ID,
    META_APP_SECRET: data.META_APP_SECRET,
    META_LOGIN_CONFIG_ID: data.META_LOGIN_CONFIG_ID,
    META_OAUTH_REDIRECT_URI: data.META_OAUTH_REDIRECT_URI,
    META_WEBHOOK_VERIFY_TOKEN: data.META_WEBHOOK_VERIFY_TOKEN,
  };
  const metaConfigured = Object.values(metaSettings).some(Boolean);
  if (metaConfigured || isProduction) {
    const required = { ...metaSettings, TOKEN_ENCRYPTION_KEY: data.TOKEN_ENCRYPTION_KEY };
    for (const [name, value] of Object.entries(required)) {
      if (!value) problems.push(`${name}: is required to enable Facebook login`);
    }
  }
  if (isProduction && data.META_OAUTH_REDIRECT_URI?.startsWith('http://')) {
    problems.push('META_OAUTH_REDIRECT_URI: must use https in production');
  }
  if (problems.length) fail(problems);

  return Object.freeze({
    nodeEnv,
    isProduction,
    isTest: nodeEnv === 'test',
    port: data.PORT,
    frontendOrigins: data.FRONTEND_URL,
    logLevel: data.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info'),
    trustProxy: data.TRUST_PROXY ?? (isProduction ? 1 : 0),
    rateLimit: Object.freeze({
      windowMs: data.RATE_LIMIT_WINDOW_MS,
      max: data.RATE_LIMIT_MAX,
    }),
    mongodbUri: data.MONGODB_URI,
    auth: Object.freeze({
      jwtSecret: data.JWT_SECRET,
      accessTokenTtlSeconds: data.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlDays: data.REFRESH_TOKEN_TTL_DAYS,
      bcryptRounds: data.BCRYPT_ROUNDS,
      cookieSameSite: data.REFRESH_COOKIE_SAMESITE ?? (isProduction ? 'none' : 'lax'),
      cookieSecure: isProduction,
      rateLimitMax: data.AUTH_RATE_LIMIT_MAX,
    }),
    leadSync: Object.freeze({ maxRequestsPerForm: data.LEAD_SYNC_MAX_REQUESTS_PER_FORM }),
    webhook: Object.freeze({ workerIntervalMs: data.WEBHOOK_WORKER_INTERVAL_MS }),
    meta: metaConfigured
      ? Object.freeze({
          appId: data.META_APP_ID,
          appSecret: data.META_APP_SECRET,
          graphVersion: data.META_GRAPH_API_VERSION,
          loginConfigId: data.META_LOGIN_CONFIG_ID,
          redirectUri: data.META_OAUTH_REDIRECT_URI,
          webhookVerifyToken: data.META_WEBHOOK_VERIFY_TOKEN,
        })
      : null,
    tokenEncryption: data.TOKEN_ENCRYPTION_KEY
      ? Object.freeze({
          current: Buffer.from(data.TOKEN_ENCRYPTION_KEY, 'base64'),
          previous: (data.TOKEN_ENCRYPTION_KEY_PREVIOUS ?? '')
            .split(',')
            .map((key) => key.trim())
            .filter(Boolean)
            .map((key) => Buffer.from(key, 'base64')),
        })
      : null,
  });
}

export const env = parseEnv();
