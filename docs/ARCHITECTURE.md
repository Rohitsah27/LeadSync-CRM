# Architecture

## Layout

```
client/   Vite + React SPA
server/   Express 5 API (ESM)
  config/       env.js (validated at startup), db.js (Phase 2)
  controllers/  thin HTTP handlers
  middleware/   auth, workspace scope, validation, rate limiting, error handling
  models/       Mongoose models
  routes/       /api/v1 routers
  services/     Meta Graph client, OAuth, token crypto, lead sync, webhook processing
  webhooks/     Meta webhook routes (raw-body signature verification)
  utils/        logger, AppError
  app.js        builds the Express app (testable)
  server.js     starts the HTTP server
```

## Multi-tenancy

- One shared database. Every tenant document carries `workspaceId`, and every index on tenant data starts with `workspaceId`.
- All queries go through a workspace-scoped helper so a missing filter cannot leak another tenant's data.
- A user belongs to one workspace with a role (owner, admin, member).
- An active Facebook Page ID is unique across the whole system: one Page can feed only one workspace at a time. Webhook routing is `page_id` to workspace, so this prevents cross-tenant lead delivery.

## Data model

| Model              | Purpose                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| User               | Credentials, profile, `workspaceId`, role                                          |
| Workspace          | The tenant (a business)                                                            |
| FacebookConnection | A connected Facebook account: encrypted token, granted scopes, status              |
| FacebookPage       | A Page the workspace selected: encrypted Page token, webhook subscription          |
| LeadForm           | A Lead Ads form on a Page, with sync cursor                                        |
| Lead               | Normalized lead plus encrypted raw payload; unique `{workspaceId, facebookLeadId}` |
| WebhookEvent       | Durable record of each webhook delivery; unique per `leadgen_id`                   |
| OAuthState         | Single-use OAuth `state` nonce with a TTL index                                    |
| DeletionRequest    | Meta data-deletion callback requests and their status                              |

## Security rules

- Meta tokens are encrypted with AES-256-GCM (per-record IV, key id for rotation), excluded from queries by default, never logged, and never returned to the browser.
- The Meta App Secret exists only on the server.
- Webhook signatures (`X-Hub-Signature-256`) are verified against the raw request body.
- Request logs redact `Authorization`, `Cookie` and `Set-Cookie`.
- CORS allows only the origins in `FRONTEND_URL`.

## Facebook connection flow (Phase 4 onwards)

```
1. Browser  POST /facebook/connect (JWT)   -> server stores single-use state, returns Meta dialog URL
2. Meta     redirects to /facebook/oauth/callback?code&state
3. Server   validates and consumes state, exchanges code (app secret stays server-side),
            exchanges for a long-lived user token, checks granted scopes with debug_token,
            stores the encrypted FacebookConnection for the workspace
4. Server   GET /me/accounts -> FacebookPage rows; user selects Pages;
            connecting a Page subscribes it: POST /{page}/subscribed_apps?subscribed_fields=leadgen
5. Server   GET /{page}/leadgen_forms -> LeadForm; GET /{form}/leads (cursor paging) -> Lead (deduped)
```

## Webhook flow (Phase 7)

```
GET   verify: compare hub.verify_token, echo hub.challenge
POST  event : verify signature on raw body -> insert WebhookEvent (unique leadgen_id)
              -> respond 200 immediately
Worker      : fetch GET /{leadgen_id} with the Page token -> upsert Lead
              retry with backoff on rate-limit errors; mark connection expired on error 190
```

Meta retries failed deliveries for up to 36 hours, so handlers must be idempotent.

## Conventions

- REST under `/api/v1`. Errors use one shape: `{ "error": { "code", "message", "details?", "requestId" } }`.
- Input validation with zod. Configuration is validated at startup and the process fails fast.
- Tests: Vitest and Supertest on the server, Vitest and Testing Library on the client.
