import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globalSetup: ['./tests/globalSetup.js'],
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      FRONTEND_URL: 'https://app.leadsync.test',
      // Placeholder only: tests connect to an in-memory MongoDB through tests/helpers/db.js.
      MONGODB_URI: 'mongodb://127.0.0.1:1/leadsync_unused',
      JWT_SECRET: 'test-only-secret-that-is-at-least-32-characters-long',
      BCRYPT_ROUNDS: '4',
      // Rate limiting has its own unit test; the integration suites make far more requests than
      // a real client would from one address.
      RATE_LIMIT_MAX: '100000',
      AUTH_RATE_LIMIT_MAX: '1000',
      // Fake Meta app. Tests never reach Facebook: tests/helpers/graphMock.js replaces fetch.
      META_APP_ID: '1234567890123456',
      META_APP_SECRET: 'test-app-secret-0123456789abcdef',
      META_LOGIN_CONFIG_ID: '9876543210',
      META_OAUTH_REDIRECT_URI: 'https://api.leadsync.test/api/v1/facebook/oauth/callback',
      META_GRAPH_API_VERSION: 'v25.0',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    },
  },
});
