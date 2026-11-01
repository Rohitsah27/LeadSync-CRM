# API reference

Base URL: the backend origin. Versioned routes live under `/api/v1`.

## Conventions

- JSON requests and responses. Request bodies are limited to 100 KB.
- Every response carries an `X-Request-Id` header. Quote it when reporting a problem.
- Authenticated routes expect `Authorization: Bearer <accessToken>`.
- Rate limiting applies to `/api/v1`. Limits are reported in the standard `RateLimit` headers; exceeding them returns `429`.
- Errors use a single shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "email", "message": "Enter a valid email address" }],
    "requestId": "0b1f6c3e-6d5a-4c53-9f0e-2d8d9a4f7c11"
  }
}
```

| Status | Code                       | Meaning                                                  |
| ------ | -------------------------- | -------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`         | Input failed validation (see `details`)                  |
| 400    | `INVALID_JSON`             | Body is not valid JSON                                   |
| 400    | `INVALID_CURRENT_PASSWORD` | Current password is wrong                                |
| 401    | `UNAUTHENTICATED`          | No access token supplied                                 |
| 401    | `TOKEN_EXPIRED`            | Access token expired; refresh and retry                  |
| 401    | `INVALID_TOKEN`            | Access token is malformed, forged, or no longer valid    |
| 401    | `INVALID_CREDENTIALS`      | Wrong email or password (the same for both)              |
| 401    | `INVALID_REFRESH_TOKEN`    | Refresh cookie missing, expired, or revoked              |
| 400    | `INVALID_SIGNED_REQUEST`   | A Meta callback had a missing or invalid signature       |
| 403    | `FORBIDDEN`                | Your role is not allowed to do this                      |
| 429    | `FACEBOOK_RATE_LIMITED`    | Facebook is limiting requests; try again shortly         |
| 502    | `FACEBOOK_ERROR`           | Facebook returned an error or could not be reached       |
| 503    | `FACEBOOK_NOT_CONFIGURED`  | The server has no Meta app settings                      |
| 403    | `ORIGIN_NOT_ALLOWED`       | Cookie-authenticated request from an unlisted origin     |
| 404    | `NOT_FOUND`                | Unknown route                                            |
| 409    | `EMAIL_IN_USE`             | An account with this email already exists                |
| 409    | `REFRESH_CONFLICT`         | Another request just rotated this session; retry shortly |
| 413    | `PAYLOAD_TOO_LARGE`        | Body exceeds the size limit                              |
| 429    | `RATE_LIMITED`             | Too many requests                                        |
| 500    | `INTERNAL_ERROR`           | Unexpected server error                                  |

## Sessions

Sign-in returns a short-lived **access token** in the response body and sets a **refresh token** in an httpOnly cookie (`ls_refresh`, path `/api/v1/auth`). The refresh token is never in a response body. Browser clients must send requests with credentials enabled.

Session responses (register, login, refresh, password change) share one shape:

```json
{
  "user": {
    "id": "665f...",
    "name": "Asha Rao",
    "email": "asha@example.com",
    "role": "owner",
    "workspaceId": "665f...",
    "createdAt": "2026-11-01T13:00:00.000Z",
    "lastLoginAt": null
  },
  "workspace": { "id": "665f...", "name": "Rao Realty", "createdAt": "2026-11-01T13:00:00.000Z" },
  "accessToken": "eyJ...",
  "expiresIn": 900
}
```

Passwords must be at least 10 characters and at most 72 bytes.

### Auth

| Method | Path                      | Auth           | Description                                          |
| ------ | ------------------------- | -------------- | ---------------------------------------------------- |
| POST   | `/api/v1/auth/register`   | none           | Create a workspace and its owner account; `201`      |
| POST   | `/api/v1/auth/login`      | none           | Sign in                                              |
| POST   | `/api/v1/auth/refresh`    | refresh cookie | Rotate the refresh cookie and get a new access token |
| POST   | `/api/v1/auth/logout`     | refresh cookie | End this session; `204`, always succeeds             |
| POST   | `/api/v1/auth/logout-all` | Bearer         | End every session for the user; `204`                |

`register` body: `{ "name", "businessName", "email", "password" }`.
`login` body: `{ "email", "password" }`.

Failed sign-ins are limited to 20 per 15 minutes per IP, and registrations to 20 per hour per IP (`AUTH_RATE_LIMIT_MAX`).

`refresh` and `logout` also reject requests whose `Origin` header is not one of `FRONTEND_URL` (`403`). If two tabs refresh at the same instant, the second receives `409 REFRESH_CONFLICT` and should retry once.

### Users

All require a Bearer token.

| Method | Path                        | Description                                                                                           |
| ------ | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/users/me`          | Current user and workspace                                                                            |
| PATCH  | `/api/v1/users/me`          | Update the profile. Body: `{ "name" }`. Other fields are ignored                                      |
| POST   | `/api/v1/users/me/password` | Body: `{ "currentPassword", "newPassword" }`. Signs out all other devices and returns a fresh session |

## Workspace

All require a Bearer token. The workspace is always the caller's own, taken from the authenticated user; there is no way to address another workspace, and ids from other workspaces are reported as `404`.

Roles are ordered `member` < `admin` < `owner`. The role is read from the database on each request, so a demotion applies immediately.

| Method | Path                                | Minimum role | Description                                                    |
| ------ | ----------------------------------- | ------------ | -------------------------------------------------------------- |
| GET    | `/api/v1/workspace`                 | member       | The workspace, the caller's role and the member count          |
| PATCH  | `/api/v1/workspace`                 | admin        | Rename the workspace. Body: `{ "name" }` (2 to 100 characters) |
| GET    | `/api/v1/workspace/members`         | member       | Everyone in the workspace, oldest first, including deactivated |
| GET    | `/api/v1/workspace/members/:userId` | member       | One member; `404` if they belong to a different workspace      |

`GET /api/v1/workspace` returns `{ "workspace": { "id", "name", "createdAt" }, "memberCount": 1, "role": "owner" }`.

A member looks like `{ "id", "name", "email", "role", "isActive", "createdAt", "lastLoginAt" }`. Password data is never included.

Inviting teammates is not built yet, so a workspace has only its owner for now.

## Facebook

Connects a workspace to Facebook with Facebook Login for Business. Tokens are encrypted in the database and never appear in any response or URL. Connecting, re-checking and disconnecting need the `admin` role; listing is open to every member.

| Method | Path                                     | Auth           | Description                                                         |
| ------ | ---------------------------------------- | -------------- | ------------------------------------------------------------------- |
| GET    | `/api/v1/facebook/connections`           | Bearer         | `{ configured, requiredScopes, connections }`                       |
| POST   | `/api/v1/facebook/connect`               | Bearer, admin  | Returns `{ authorizationUrl }` and sets the `ls_oauth_state` cookie |
| GET    | `/api/v1/facebook/oauth/callback`        | state cookie   | Where Facebook redirects the browser; always redirects to the app   |
| POST   | `/api/v1/facebook/connections/:id/check` | Bearer, admin  | Re-validates the token with Facebook and returns the connection     |
| DELETE | `/api/v1/facebook/connections/:id`       | Bearer, admin  | Revokes the Facebook permissions and deletes the connection; `204`  |
| POST   | `/api/v1/facebook/deauthorize`           | signed_request | Meta's deauthorize callback; revokes the account in every workspace |

A connection looks like:

```json
{
  "id": "665f...",
  "facebookUserId": "10001000100010",
  "name": "Fiona Business",
  "status": "active",
  "statusReason": null,
  "grantedScopes": ["pages_show_list", "leads_retrieval"],
  "missingScopes": ["pages_read_engagement", "pages_manage_metadata", "pages_manage_ads"],
  "tokenExpiresAt": "2026-12-31T00:00:00.000Z",
  "dataAccessExpiresAt": "2027-01-30T00:00:00.000Z",
  "lastVerifiedAt": "2026-11-01T10:00:00.000Z",
  "connectedAt": "2026-11-01T09:00:00.000Z",
  "connectedBy": "665f..."
}
```

`status` is `active`, `expired`, `revoked` or `error`. Anything other than `active` means the stored token was discarded and the account must be reconnected. A successful login does not guarantee lead access, so `missingScopes` lists any required permission the user did not grant.

### The connect flow

1. The app calls `POST /facebook/connect`, which stores a single-use state (as a hash) and sets an httpOnly `ls_oauth_state` cookie holding the same value, then returns the Facebook dialog URL.
2. The browser goes to Facebook and the user approves.
3. Facebook redirects to `/facebook/oauth/callback?code&state`. The state must match both the cookie and the stored record, which proves the same browser started the flow.
4. The server exchanges the code, upgrades to a long-lived token, confirms with Facebook whose token it is and which permissions it holds, and stores it encrypted.
5. The browser is redirected to `{FRONTEND_URL}/connections?facebook=connected`, or `?facebook=error&reason=...` with one of `denied`, `state`, `exchange`, `unavailable`, `config`, `internal`.

## Health

`GET /health` and `GET /api/v1/health`

The root path is for the Render health check and is not rate limited or logged. It always returns `200`; `database` reports the MongoDB connection (`connected`, `connecting`, `disconnecting` or `disconnected`).

```json
{ "status": "ok", "database": "connected", "uptime": 42, "timestamp": "2026-11-01T13:00:00.000Z" }
```

More endpoints are documented as each phase lands: workspaces (3), Facebook OAuth (4), Pages (5), forms and leads (6), webhooks (7).
