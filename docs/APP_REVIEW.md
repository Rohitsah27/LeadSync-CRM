# Meta App Review preparation

Status: outline only. Filled in during Phases 9 and 10.

## Prerequisites

- [ ] Business Verification completed for the business that owns the app
- [ ] Tech Provider onboarding (data-handling questions and approval)
- [ ] Privacy Policy URL published
- [ ] Terms of Service URL published
- [ ] Data Deletion Request URL live and tested
- [ ] App in Live mode with an app icon and category

## Permissions to request (Advanced Access)

For each permission: use-case description, screencast, and testing instructions.

| Permission              | Planned use-case summary                                       |
| ----------------------- | -------------------------------------------------------------- |
| `pages_show_list`       | Show the user the Pages they can connect                       |
| `pages_read_engagement` | Read Page metadata required to retrieve leads                  |
| `pages_manage_metadata` | Subscribe selected Pages to lead notifications                 |
| `leads_retrieval`       | Import leads from the user's own Lead Ads forms into their CRM |
| `pages_manage_ads`      | Required dependency for reading lead forms and leads           |

## Screencast checklist

1. Sign up and log in to LeadSync.
2. Click Connect Facebook and complete the Meta dialog.
3. Select a Page and show the connection status.
4. Show the lead forms for the Page.
5. Submit a test lead and show it appearing through the webhook.
6. Change a lead's status.
7. Disconnect Facebook and show the data removal.

## Reviewer testing instructions

To be written: test account credentials (supplied through the review form, never committed), step-by-step flow, and expected results.
