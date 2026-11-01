# API reference

Base URL: the backend origin. Versioned routes live under `/api/v1`.

## Conventions

- JSON requests and responses. Request bodies are limited to 100 KB.
- Every response carries an `X-Request-Id` header. Quote it when reporting a problem.
- Rate limiting applies to `/api/v1`. Limits are reported in the standard `RateLimit` headers; exceeding them returns `429`.
- Errors use a single shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "email", "message": "Invalid email" }],
    "requestId": "0b1f6c3e-6d5a-4c53-9f0e-2d8d9a4f7c11"
  }
}
```

| Status | Code                | Meaning                     |
| ------ | ------------------- | --------------------------- |
| 400    | `VALIDATION_ERROR`  | Input failed validation     |
| 400    | `INVALID_JSON`      | Body is not valid JSON      |
| 404    | `NOT_FOUND`         | Unknown route               |
| 413    | `PAYLOAD_TOO_LARGE` | Body exceeds the size limit |
| 429    | `RATE_LIMITED`      | Too many requests           |
| 500    | `INTERNAL_ERROR`    | Unexpected server error     |

## Endpoints

### Health

`GET /health` and `GET /api/v1/health`

The root path is for the Render health check and is not rate limited or logged.

```json
{ "status": "ok", "uptime": 42, "timestamp": "2026-11-01T13:00:00.000Z" }
```

More endpoints are documented as each phase lands: auth (Phase 2), workspaces (3), Facebook OAuth (4), Pages (5), forms and leads (6), webhooks (7).
