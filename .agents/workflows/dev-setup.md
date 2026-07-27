---
description: How to set up and run the WheresTheFX development environment
---

# WheresTheFX dev setup

An npm workspace monorepo — install once at the root, never per package.

Full detail in [docs/README.md](../../docs/README.md).

## Prerequisites

- Node.js 18+
- PostgreSQL running locally

## Steps

// turbo-all

1. Create the database:

```bash
psql postgresql://postgres:postgres@localhost:5432 -c "CREATE DATABASE wheresthefx;"
```

2. Configure the environment. `JWT_SECRET` is required and must be 32+
   characters — the API refuses to start without it rather than falling
   back to a default anyone could guess:

```bash
cp .env.example .env
openssl rand -hex 32   # paste into JWT_SECRET
```

3. Install everything, from the root:

```bash
npm install
```

4. Apply the migrations. Use this rather than `drizzle-kit push`: the
   migrations are versioned, so a schema change stays reversible:

```bash
npm run db:migrate
```

5. Start the API. It also runs the ingest scheduler, and in production
   serves the built client from the same origin:

```bash
npm run dev:api    # http://localhost:3001
```

6. In another terminal, start the client. It proxies `/api` to the API,
   so there is no CORS in development either:

```bash
npm run dev:web    # http://localhost:5173
```

7. Open http://localhost:5173.

An empty database serves an empty map. To fill it, see
[run-ingest.md](run-ingest.md).

## Before pushing

```bash
npm run check
```

Naming gate, copy gate, class gate, ESLint, typecheck across every
workspace, tests, and a production build of the client. The build is
included because lint and typecheck both pass on a bundle that will not
build.
