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
  });
}

export const env = parseEnv();
