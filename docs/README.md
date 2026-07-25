# WheresTheFX

**Metro Manila Event Discovery Platform** — Find parties, thrift markets, live music, food events, and more on an interactive map.

**Production:** [www.wheresthefx.com](https://www.wheresthefx.com) | **API:** [api.wheresthefx.com](https://api.wheresthefx.com/api/events/map)

## Architecture

```
┌─────────────────────────────────────────────────┐
│                    blead (VPS)                   │
│  Playwright + Gemini AI → SQLite (ig-events.db)  │
│  Scrapes ~157 Instagram accounts daily           │
└─────────────────┬───────────────────────────────┘
                  │ ingest script (every 6hrs)
                  ▼
┌─────────────────────────────────────────────────┐
│              WheresTheFX Server                  │
│  Express.js + Drizzle ORM + PostgreSQL           │
│  REST API: /api/events, /api/venues, etc.        │
│  Image proxy for Instagram CDN fallback          │
│  JWT auth                                        │
│  Port: 3001                                      │
└─────────────────┬───────────────────────────────┘
                  │ fetch API
                  ▼
┌─────────────────────────────────────────────────┐
│              WheresTheFX Client                  │
│  React + Vite + TypeScript + Tailwind            │
│  Leaflet dark-themed map                         │
│  Category filters, search, date/price filters    │
│  Math verification landing page                  │
│  Port: 5173                                      │
└─────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL (OrbStack or local)
- blead repo at `../blead` (for ingest)

### Setup

This is an npm workspace monorepo — install once at the root.

```bash
# 1. Create PostgreSQL database
psql -c "CREATE DATABASE wheresthefx;"

# 2. Configure environment
cp .env.example .env
# JWT_SECRET is required and must be 32+ chars — the API refuses to start
# without it. Generate one with: openssl rand -base64 48

# 3. Install everything
npm install

# 4. Apply the schema
npm run db:migrate

# 5. Run ingest (needs data/ig-events.db — see docs/ingest.md)
npm run ingest --workspace @wheresthefx/api

# 6. Start the API and the client, in separate shells
npm run dev:api    # → http://localhost:3001
npm run dev:web    # → http://localhost:5173
```

### Verifying

```bash
npm run typecheck   # all workspaces, strict
npm run lint
npm run test
```

These three are the gate CI enforces on every push.

### Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable            | Description                          | Default                                                     |
| ------------------- | ------------------------------------ | ----------------------------------------------------------- |
| `DATABASE_URL`      | PostgreSQL connection string         | `postgresql://postgres:postgres@localhost:5432/wheresthefx` |
| `JWT_SECRET`        | **Required.** 32+ chars, no default. | — (startup fails without it)                                |
| `BLEAD_DB_PATH`     | Source SQLite for the ingest         | `./data/ig-events.db`                                       |
| `BLEAD_IMAGES_PATH` | Local image cache, if present        | — (proxy falls back to CDN)                                 |
| `PORT`              | API port                             | `3001`                                                      |
| `CORS_ORIGIN`       | Allowed origin, comma-separated      | `http://localhost:5173`                                     |
| `VITE_API_URL`      | API base URL (client)                | `http://localhost:3001`                                     |

## Project Structure

An npm workspace monorepo. Directory names are singular, per
[CONVENTIONS.md](CONVENTIONS.md).

```
wheresthefx/
├── app/
│   ├── api/                     # Express REST API  (@wheresthefx/api)
│   │   └── src/
│   │       ├── db/              # Every SQL statement lives here
│   │       ├── lib/param.ts     # Validated query/route param parsing
│   │       ├── middleware/      # auth (JWT), snakeCase response
│   │       ├── routes/          # events, venues, categories, auth, users, export
│   │       ├── scripts/         # ingest, dedup, geocode, export-tripi
│   │       └── index.ts         # App entry, CORS, image proxy, health
│   └── web/                     # Vite + React client  (@wheresthefx/web)
│       └── src/
│           ├── api/client.ts    # API client
│           ├── components/      # events, badges, map, shared, ui
│           ├── hooks/
│           ├── pages/           # Index (map), Auth, NotFound
│           ├── types/filter.ts  # Map filter shape
│           └── utils/           # markerUtils, dateRange, dateUtils
├── package/
│   ├── core/                    # Shared contracts  (@wheresthefx/core)
│   │   └── src/
│   │       ├── category.ts      # THE canonical 12-category taxonomy
│   │       ├── geo.ts           # Haversine, coordinates, proximity clustering
│   │       ├── time.ts          # Manila-time helpers
│   │       └── tripi.ts         # The tripi export contract + mappers
│   ├── db/                      # Schema + migration  (@wheresthefx/db)
│   │   ├── migration/           # Drizzle migrations (versioned)
│   │   └── src/schema.ts        # 9 tables — single source of truth
│   └── ingest/                  # In-house scrape + AI pipeline (in progress)
├── docs/
├── data/                        # gitignored — recovered SQLite, backups
└── package.json                 # Workspace root
```

### Why the shared packages exist

`package/db` holds the only copy of the schema. Previously the API and
the ingest each kept their own, which is how the ingest came to write
~20 columns that did not exist — Drizzle discards unknown keys silently,
so it looked like it was working while writing NULLs.

`package/core` holds anything both sides must agree on. The category
taxonomy lived in three places with three different value sets, and the
sync between them collapsed five of the twelve categories to `other` on
every run.

Everything in `package/core` is pure — no database, no Express, no React, no
DOM — with no runtime dependency beyond `zod`. That is a hard constraint, not
a style: it is what lets tripi read this tree without inheriting this repo's
stack, and it is why the haversine moved out of `markerUtils.ts` (which also
imports Leaflet and a PNG, so nothing outside the browser could reach it and
the API grew a second copy of the same formula). See [TRIPI.md](TRIPI.md).

## Data Pipeline

### Source: blead

blead is a separate system that scrapes Instagram daily:

- **157 accounts** tracked (venues, promoters, organizers in Metro Manila)
- **Playwright** headless browser extracts posts
- **Gemini AI** classifies posts as events and extracts structured data
- Stores everything in SQLite at `data/ig-events.db`

### Ingest: SQLite → PostgreSQL

The `ingest-from-blead.ts` script syncs data:

1. **Venues** — matched by `name` (UNIQUE)
2. **Accounts** — matched by `username` (UNIQUE)
3. **Posts** — matched by `shortcode` (UNIQUE)
4. **Events** — matched by `event_hash` (SHA256 of title+date+venue)
5. **Sub-events** — delete + re-insert per parent event

Run every 6 hours via cron on the VPS:

```bash
0 0,6,12,18 * * * cd /path/to/wheresthefx && npm run ingest --workspace @wheresthefx/api
```

### Data state (July 2026)

The pipeline stopped running around 19 June 2026. The site and API stayed
up, but inventory aged out — production holds 1,920 events of which only a
handful are still upcoming. Bringing ingestion in-house is the active work.

Recovered from the VPS into `data/` (gitignored):

| Table          | Count |
| -------------- | ----- |
| Accounts       | 212   |
| Posts          | 5,652 |
| Events         | 2,368 |
| Sub-events     | 2,740 |
| Known venues   | 361   |
| Image cache    | 3.6GB (left on the VPS) |

## API Reference

All endpoints are prefixed with `/api`. All responses use **snake_case** keys.
See [docs/api.md](api.md) for full reference.

### Auth

| Method | Path             | Description    | Auth |
| ------ | ---------------- | -------------- | ---- |
| `POST` | `/auth/register` | Create account | No   |
| `POST` | `/auth/login`    | Login, get JWT | No   |
| `GET`  | `/auth/me`       | Current user   | Yes  |

### Events

| Method | Path               | Description             | Auth     |
| ------ | ------------------ | ----------------------- | -------- |
| `GET`  | `/events`          | List events (paginated) | Optional |
| `GET`  | `/events/upcoming` | Future events           | No       |
| `GET`  | `/events/map`      | Events with geocoding   | No       |
| `GET`  | `/events/:id`      | Event detail            | Optional |

Query params: `category`, `search`, `is_free`, `date_from`, `date_to`, `page`, `limit`

### Venues

| Method | Path                 | Description     | Auth |
| ------ | -------------------- | --------------- | ---- |
| `GET`  | `/venues`            | All venues      | No   |
| `GET`  | `/venues/:id`        | Venue detail    | No   |
| `GET`  | `/venues/:id/events` | Events at venue | No   |

### Categories

| Method | Path          | Description            | Auth |
| ------ | ------------- | ---------------------- | ---- |
| `GET`  | `/categories` | Categories with counts | No   |

### User

| Method | Path                    | Description        | Auth |
| ------ | ----------------------- | ------------------ | ---- |
| `GET`  | `/users/me/saved`       | Saved events       | Yes  |
| `POST` | `/users/me/saved`       | Toggle save event  | Yes  |
| `GET`  | `/users/me/preferences` | Get preferences    | Yes  |
| `PUT`  | `/users/me/preferences` | Update preferences | Yes  |

### Image Proxy

| Method | Path                                  | Description            |
| ------ | ------------------------------------- | ---------------------- |
| `GET`  | `/images/proxy?url=...&shortcode=...` | Proxy Instagram images |

### Export (the tripi feed)

| Method | Path                              | Description                    | Auth |
| ------ | --------------------------------- | ------------------------------ | ---- |
| `GET`  | `/export/place-draft`             | Venue catalog as tripi drafts  | No   |
| `GET`  | `/export/event-draft?since=...`   | Upcoming events as tripi drafts| No   |

wheresthefx is one of [tripitropi.com](https://tripitropi.com)'s catalog sources: open datasets
tell tripi that a bar exists, this tells it there is a night market in Poblacion on Friday, which
is the half that matters once tripi has solved for the days a crew is free. Contract, skip
reasons, and what tripi has to change to consume it: [TRIPI.md](TRIPI.md).

## Database Schema

9 tables connected via foreign keys:

- **venue** — Canonical venue directory with geocoding
- **source_account** — Instagram accounts being tracked
- **source_post** — Raw IG posts with AI extraction data
- **event** — Core event data with `event_hash` dedup
- **sub_event** — Multi-act lineups and schedules
- **account** — Platform user accounts (bcrypt passwords)
- **saved_event** — User bookmarks (many-to-many)
- **account_preference** — Preferred categories
- **sync_log** — Ingest run tracking

Key design decisions:

- No dependency on blead's internal IDs
- `event_hash` (SHA256) for deduplication
- Denormalized `venue_name`/`source_username` for query performance
- JSONB arrays for `artists`
- API responses auto-converted to snake_case by `snakeCaseResponse` middleware

## Deployment

### VPS (Express API)

```bash
# Sync server code to VPS
rsync -avz --delete --exclude='node_modules' --exclude='.env' --exclude='drizzle' \
  server/ root@217.216.72.28:/root/wheresthefx-api/

# Restart on VPS
ssh root@217.216.72.28 "pm2 restart wheresthefx-api"
```

- API: `https://api.wheresthefx.com` (port 3001 behind Caddy reverse proxy)
- SSL: Let's Encrypt via Caddy
- Process manager: PM2

### Vercel (Frontend)

```bash
# Deploy to production
vercel --prod --yes
```

- Frontend: `https://www.wheresthefx.com`
- Env: `VITE_API_URL=https://api.wheresthefx.com`
- DNS: Namecheap BasicDNS → Vercel

## Tech Stack

| Layer         | Technology                               |
| ------------- | ---------------------------------------- |
| Frontend      | React 18, Vite, TypeScript, Tailwind CSS |
| UI Components | shadcn/ui (Radix primitives)             |
| Map           | Leaflet with custom markers              |
| Backend       | Express.js, TypeScript                   |
| ORM           | Drizzle ORM                              |
| Database      | PostgreSQL (OrbStack)                    |
| Auth          | JWT (jsonwebtoken + bcryptjs)            |
| Data Source   | blead (Playwright + Gemini AI → SQLite)  |
