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
- A user belongs to one workspace with a role. Roles rank `member` < `admin` < `owner`, and `requireRole('admin')` allows that role and above. The role is read from the database on every request.
- **Isolation is enforced in code, not by convention.** Tenant models use the `tenantScope` Mongoose plugin (`server/models/plugins/tenantScope.js`):
  - Every find, update, delete and count must filter on a single `workspaceId`, and every aggregation must start with a `$match` on it. Anything else throws a `TenantScopeError`. Filters like `$ne`, `$in`, `$exists` or a `workspaceId` buried inside `$or` do not count.
  - A document can never be moved to another workspace through an update.
  - `Model.inWorkspace(id)` is the normal way in: it returns the usual query methods with the scope built in, overrides any caller-supplied `workspaceId`, and stamps `workspaceId` on `create`.
  - `.unscoped()` is the explicit opt-out for lookups made before a workspace is known (signing in by email, resolving a token's user). It is greppable, so every cross-tenant read is easy to review.
  - Not covered: `bulkWrite` and raw collection access skip Mongoose middleware, so avoid them on tenant models.
  - New tenant models (`Lead`, `FacebookPage`, and so on) just add `schema.plugin(tenantScope)`.
- The workspace for a request comes from the authenticated user (`req.workspaceId`), never from the body, query string or headers. Ids from another workspace return `404`, not `403`, so they cannot be probed.
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

## Authentication (Phase 2)

- **Access token:** a JWT (HS256, 15 minutes) that the SPA keeps in memory and sends as a Bearer token. It carries only the user id. The API loads the user from the database on every request, so deactivating an account or changing a password takes effect immediately.
- **Refresh token:** 48 random bytes in an httpOnly cookie (`ls_refresh`) scoped to `/api/v1/auth`. Only its SHA-256 hash is stored, in the `RefreshToken` collection (with a TTL index that removes expired rows).
- **Rotation and reuse detection:** every refresh consumes the old token atomically and issues a new one in the same family. Replaying an already-rotated token revokes the whole family. Two tabs refreshing within 10 seconds of each other get a `409` instead, so a normal race does not end the session.
- **CSRF:** `refresh` and `logout` reject requests whose `Origin` is not in `FRONTEND_URL`. The cookie is `SameSite=Lax` in development and `SameSite=None; Secure` in production, because the Render frontend and API sit on different sites. Phase 10 should revisit this: a shared custom domain or a same-origin proxy would allow `Lax`.
- **Passwords:** bcrypt (cost 12; at least 10 is enforced in production), 10 to 72 bytes. Sign-in compares against a decoy hash when the email is unknown and returns one error for both failure modes. Registration does reveal whether an email is taken (`409`); this is limited by rate limiting and can be revisited with email verification.
- **Password change:** revokes every refresh token, rejects access tokens issued before the change, and starts a fresh session for the device that made the change.
- **Tenancy boundary:** registering creates a `Workspace` and its owner. `req.workspaceId` is set from the authenticated user and never from request input. See Multi-tenancy for how queries are scoped. Teammate invitations are not built yet, so every workspace currently has only its owner.

## Facebook OAuth (Phase 4)

- **Login product:** Facebook Login for Business. The dialog uses `config_id` instead of `scope`, and `response_type=code`, so the code is exchanged on the server and the App Secret never leaves it.
- **State bound to the browser.** The `state` is random, stored only as a hash, single-use and valid for 10 minutes. A matching httpOnly cookie is set when the flow starts, and the callback requires both. Without the cookie, an attacker could start a flow in their own workspace and trick a victim into finishing it, attaching the victim's Facebook account to the attacker's workspace.
- **Verified, not assumed.** After the code exchange the server asks Facebook (`debug_token`) whose token it is, which app issued it and which permissions it holds. A token for another app or user is rejected, and missing permissions are recorded so the UI can say lead access is incomplete.
- **Tokens at rest:** long-lived tokens are encrypted with AES-256-GCM (`services/tokenCrypto.js`). Each value has its own random IV and is bound to its workspace and Facebook user, so it cannot be copied onto another record. The key ring supports rotation. Tokens are never selected by default, never logged, and never returned or put in a URL.
- **Expiry and revocation:** connections move to `expired`, `revoked` or `error` when a check shows the token is dead, and the dead token is deleted. Facebook's deauthorize callback revokes an account in every workspace at once. Data access (about 90 days) is tracked separately from token expiry.
- **Disconnecting** deletes the connection and revokes the Facebook permissions, unless another workspace uses the same Facebook account, because a revocation would break theirs.
- **Graph client** (`services/meta/graphClient.js`): adds `appsecret_proof`, enforces a timeout, never logs URLs, and groups Meta's error codes into auth, permission, rate-limit and unavailable.
- The Facebook settings are validated together at startup (all or none, mandatory in production).

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
