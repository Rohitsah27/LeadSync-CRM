# Meta app setup

Values and dashboard steps needed before Phase 4. Verified against Meta's documentation on 2026-11-01.

## Graph API version

- Latest: v26.0 (released 2026-07-29). v25.0 is supported until 2028-07-29.
- The version is the `META_GRAPH_API_VERSION` environment variable. Default is v25.0.

## Login product

Facebook Login for Business. Create a **Configuration** under _Facebook Login for Business > Configurations_:

- Token type: **User access token** (authorization code flow).
- Authorization requests use `config_id` instead of `scope`, plus `response_type=code` and `override_default_response_type=true`.
- Business integration system user (BISU) tokens require Tech Provider status and a separate business portfolio. They are a possible later upgrade.

## Permissions

| Permission              | Why                                                             |
| ----------------------- | --------------------------------------------------------------- |
| `pages_show_list`       | List the Pages a person manages                                 |
| `pages_read_engagement` | Read Page metadata (required by lead retrieval)                 |
| `pages_manage_metadata` | Subscribe Pages to webhooks                                     |
| `leads_retrieval`       | Read lead data                                                  |
| `pages_manage_ads`      | Dependency of `leads_retrieval`; needed to read leads and forms |

Not yet confirmed: Meta lists `ads_management`, `ads_read` and `business_management` as further dependencies of `leads_retrieval`. Phase 4 starts with the five above and adds more only if the API requires them.

## Access levels

- **Development / Standard Access:** works for people who have a role on the app (admin, developer, tester). Use this for building and testing with your own Pages.
- **Production for other businesses:** requires Business Verification, App Review for Advanced Access, and Tech Provider status for apps that access other businesses' assets.
- Lead retrieval and webhooks for ordinary users do not work while the app is in Development mode.

## Values to collect

| Value                            | Where                                                  |
| -------------------------------- | ------------------------------------------------------ |
| `META_APP_ID`, `META_APP_SECRET` | App settings > Basic                                   |
| `META_LOGIN_CONFIG_ID`           | Facebook Login for Business > Configurations           |
| Valid OAuth redirect URIs        | Login settings (one for local dev, one for production) |
| `META_WEBHOOK_VERIFY_TOKEN`      | Any random string you generate                         |
| Webhook callback URL             | Public HTTPS URL (use a tunnel for local dev)          |
| Privacy Policy URL, Terms URL    | Basic settings (required to go Live)                   |
| Data Deletion Request URL        | Basic settings                                         |
| Test assets                      | A Page you admin, an ad account, a Lead Ads form       |

## Webhooks

- Subscribe the app to the **Page** object, field **leadgen**.
- Each Page is subscribed with `POST /{page-id}/subscribed_apps` using `subscribed_fields=leadgen` and a Page access token from a person who can perform the ADVERTISE task.
- Payload fields: `leadgen_id`, `page_id`, `form_id`, `ad_id`, `adgroup_id`, `created_time`.

## Phase 4 setup checklist

The OAuth code is finished and covered by tests that use a fake Graph API, but it has not yet been run against a real Meta app. To try it for real:

1. In **App settings > Basic**, copy the App ID and App Secret.
2. Create the Login for Business **configuration** (user access token) with the permissions listed above, and copy its Configuration ID.
3. Under the login settings, add the callback as a **Valid OAuth Redirect URI**. It must exactly match `META_OAUTH_REDIRECT_URI`, for example `http://localhost:5000/api/v1/facebook/oauth/callback` for local development.
4. Set the **Deauthorize Callback URL** to `https://<your-api-host>/api/v1/facebook/deauthorize`. It must be public HTTPS, so skip it for local development.
5. Put the values in `server/.env`: `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`, `META_OAUTH_REDIRECT_URI` and `TOKEN_ENCRYPTION_KEY` (a local one is generated for you). The Facebook settings are all-or-nothing: if any one is set, all must be, and the server refuses to start otherwise. They are required in production.
6. While the app is in Development mode, sign in to Facebook as someone with a role on the app.

If a connection shows missing permissions, the configuration does not include them. Adding `pages_manage_ads` is expected to be needed for lead retrieval.

### Encryption key rotation

Tokens are encrypted with AES-256-GCM using `TOKEN_ENCRYPTION_KEY`. To rotate: generate a new key, set it as `TOKEN_ENCRYPTION_KEY`, and move the old one to `TOKEN_ENCRYPTION_KEY_PREVIOUS` so existing tokens still decrypt. Remove the old key only after every token has been re-encrypted or reconnected. A connection whose token cannot be decrypted simply needs reconnecting.

## Open items to verify live

- Exact fields for `GET /{page-id}/leadgen_forms` and `GET /{form-id}/leads`. Meta's reference pages for them could not be confirmed, so the code asks for a sensible field list and retries once with a smaller one if Facebook rejects it. Check the first real sync's result.
- Which Page roles can read leads. Facebook can restrict lead access through Leads Access Manager even for Page admins; a refusal shows up as a `permission` status on the form.
- Test leads: the Lead Ads Testing Tool does not work while the app is in Development mode. Use real submissions by people with a role on the app, or create test leads through the API (`POST /{form-id}/test_leads`).
- Whether Page tokens obtained from a long-lived user token are non-expiring, checked with `debug_token` (Phase 4).
- Lead rate limit: 200 x 24 x (leads created in the past 90 days), per Page.
