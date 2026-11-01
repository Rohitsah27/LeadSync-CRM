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

## Open items to verify live

- Exact permissions and fields for listing forms: `GET /{page-id}/leadgen_forms` (Phase 6).
- Whether Page tokens obtained from a long-lived user token are non-expiring, checked with `debug_token` (Phase 4).
- Lead rate limit: 200 x 24 x (leads created in the past 90 days), per Page.
