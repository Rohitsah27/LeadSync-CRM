# LeadSync CRM

Multi-tenant SaaS that lets businesses connect their own Facebook Pages through Meta OAuth, pull in Facebook Lead Ads leads (manually and through webhooks), and manage them in a CRM dashboard. Every record is isolated by workspace.

## Status

| Phase | Scope                                  | Status      |
| ----- | -------------------------------------- | ----------- |
| 1     | Project setup and architecture         | Done        |
| 2     | MongoDB connection and authentication  | Done        |
| 3     | Workspace and multi-tenant system      | Done        |
| 4     | Meta OAuth integration                 | Built       |
| 5     | Facebook Pages integration             | Built       |
| 6     | Lead forms and lead retrieval          | Built       |
| 7     | Webhooks and automatic synchronization | Not started |
| 8     | CRM dashboard and lead management      | Not started |
| 9     | Testing and security                   | Not started |
| 10    | Render deployment                      | Not started |

Phases 4 to 6 are covered by tests that use a mocked Facebook Graph API. They have not yet been run against a real Meta app (see [Meta app setup](docs/META_SETUP.md)).

## Stack

- **Client:** React, Vite, Tailwind CSS, React Router, Axios
- **Server:** Node.js, Express 5, Mongoose (Phase 2), JWT, Meta Graph API
- **Database:** MongoDB Atlas
- **Hosting:** Render (static site + web service)
- **Tests:** Vitest, Supertest, Testing Library (server tests run against an in-memory MongoDB, so no database setup is needed)

## Getting started

Requires Node.js 22.22 or newer (`.node-version` pins 24.15.0).

```bash
npm install
cp server/.env.example server/.env
cp client/.env.example client/.env
npm run dev
```

- API: the `PORT` in `server/.env` (health check at `/health`)
- Web app: the Vite dev server URL printed in the terminal

The API will not start without `MONGODB_URI` (your Atlas connection string, including a database name) and a `JWT_SECRET` of at least 32 characters. The `.env.example` file shows how to generate one.

Real credentials belong only in `server/.env` (or Render's environment settings). `.env` files are gitignored; only `.env.example` files are committed.

## Scripts

| Command          | What it does                          |
| ---------------- | ------------------------------------- |
| `npm run dev`    | Runs the API and the web app together |
| `npm test`       | Runs server and client tests          |
| `npm run lint`   | Lints both workspaces                 |
| `npm run build`  | Builds the client for production      |
| `npm start`      | Starts the API (production mode)      |
| `npm run format` | Formats the repo with Prettier        |

`npm test` runs the server suite through `server/scripts/test.mjs`. On Node 24.15.0 for Windows a test worker sometimes dies natively (exit code `0xC0000409`) without any test failing, so the script re-runs the suite, up to 3 attempts in total, but only for that crash. A run with a real test failure is never retried. Trying Node 22 LTS may remove the crashes.

## Project structure

```
client/   React single-page app (components, pages, layouts, context, hooks, services, utils)
server/   Express API (config, controllers, middleware, models, routes, services, webhooks, utils)
docs/     Architecture, Meta setup, API reference, App Review and data handling notes
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Meta app setup](docs/META_SETUP.md)
- [API reference](docs/API.md)
- [Meta App Review preparation](docs/APP_REVIEW.md)
- [Data handling](docs/DATA_HANDLING.md)
