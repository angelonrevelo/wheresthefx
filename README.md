<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Express-API-000000?logo=express&logoColor=white" alt="Express">
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/Leaflet-map-199900?logo=leaflet&logoColor=white" alt="Leaflet">
</p>

# WheresTheFX

**Find your next function — parties, markets, gigs and food events in Metro Manila, on one map.**

Events in Manila mostly live on Instagram, scattered across a hundred venue and
promoter accounts. WheresTheFX gathers them in one place: open the map, filter
by category, date or price, and see what is on near you tonight.

- **Map first** — a dark Leaflet map with clustered event pins.
- **Filters** — category chips, search, date range, free/paid.
- **Accounts** — sign in to save events and set preferred categories.
- **Admin** — a dashboard for the people running it.

Live at **[www.wheresthefx.com](https://www.wheresthefx.com)** (API:
[api.wheresthefx.com](https://api.wheresthefx.com/api/events/map)).

## Quick start

Needs Node.js 18+, PostgreSQL, and (for real data) the sibling `blead` repo at
`../blead`.

```bash
# API server
psql -c "CREATE DATABASE wheresthefx;"
cd server
npm install
npm run db:push        # create the schema
npm run ingest         # pull events from blead's SQLite
npm run dev            # http://localhost:3001

# web client (repo root, second terminal)
npm install
npm run dev            # http://localhost:7000
```

Other scripts — root: `build`, `build:dev`, `lint`, `preview`; server: `build`,
`start`, `db:generate`, `db:migrate`, `db:studio`.

## Configuration

Copy `.env.example` to `.env`.

- `DATABASE_URL` — PostgreSQL connection string.
- `JWT_SECRET` — signs login tokens.
- `BLEAD_DB_PATH` — path to blead's SQLite database (ingest only).
- `BLEAD_IMAGES_PATH` — blead's cached Instagram images, served by the image proxy.
- `PORT` — API port (default 3001).
- `CORS_ORIGIN` — allowed web origin(s), comma-separated.
- `VITE_API_URL` — API base URL the web client calls (default `http://localhost:3001`).

## How it works

```
blead (separate repo)          Instagram accounts → Playwright + Gemini → SQLite
        │  npm run ingest  (every 6 h on the VPS)
        ▼
server/  Express + Drizzle + PostgreSQL  → REST /api/events, /api/venues, …
        │  fetch
        ▼
src/     React + Vite + Tailwind + Leaflet → the map
```

blead does the scraping and the AI extraction. This repo only syncs its output
into Postgres (deduplicating on natural keys such as an event hash), serves it
as a snake_case REST API with an Instagram image proxy, and draws the map.

## Docs

- [docs/README.md](docs/README.md) — full architecture, folder map, API table, schema, deployment
- [docs/api.md](docs/api.md) — API reference
- [docs/schema.md](docs/schema.md) — database schema
- [docs/ingest.md](docs/ingest.md) — the blead → Postgres ingest
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — code, database and API conventions
