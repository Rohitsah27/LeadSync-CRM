# Data handling

Status: outline only. Finalized in Phase 9, and the public Privacy Policy is derived from it.

## Data collected

- Account data: name, email, hashed password.
- Facebook connection data: Facebook user ID, granted permissions, encrypted access tokens.
- Page data: Page ID, name, picture, encrypted Page access token.
- Lead data: the answers submitted on a Lead Ads form (name, email, phone and custom fields) and the original payload.

## Protection

- Passwords are hashed with bcrypt.
- Meta tokens are encrypted at rest (AES-256-GCM) and never sent to the browser.
- Data is isolated per workspace.
- Raw lead payloads are stored encrypted, with a configurable retention period.

## Facebook access tokens

- Stored encrypted (AES-256-GCM) and only on the server. They never appear in API responses, URLs or logs.
- A token that Facebook reports as expired or revoked is deleted immediately.
- Disconnecting an account deletes its token and revokes the permissions on Facebook. Leads already imported stay in the workspace.
- When a user removes the app on Facebook, Meta's deauthorize callback deletes their tokens in every workspace.

## Facebook Page tokens

- Each connected Page has its own access token, stored encrypted and never returned by the API.
- It is deleted when the Page is disconnected, when its Facebook connection is disconnected, and whenever Facebook reports it expired or revoked.
- The list of Pages a user could connect is read from Facebook on demand and is not stored.

## Retention and deletion

- Disconnecting Facebook revokes and deletes the stored tokens.
- Meta's data-deletion callback (`signed_request`) deletes data tied to the requesting Facebook user and returns a status URL with a confirmation code.
- Workspace owners can request deletion of their workspace data.

## Open decisions

- Default retention period for lead data.
- Whether email and phone are encrypted at the field level (this affects search).
