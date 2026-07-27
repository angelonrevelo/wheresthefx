# WheresTheFX

**Metro Manila event discovery** — parties, markets, live music, film and workshops on an interactive map.

**Production:** [www.wheresthefx.com](https://www.wheresthefx.com)

The site, the API and the ingestion pipeline are one Node process behind
nginx. There is no separate frontend host and no separate API host: the
API serves the built client from the same origin, so there is no CORS in
production and nothing to keep in sync between two deploys.

## Quick start

Node 18+ and PostgreSQL. This is an npm workspace monorepo — install once
at the root.

```bash
psql -c "CREATE DATABASE wheresthefx;"

cp .env.example .env
# JWT_SECRET is required and must be 32+ chars; the API refuses to start
# without it. Generate one with: openssl rand -hex 32

npm install
npm run db:migrate

npm run dev:api    # http://localhost:3001 — API + scheduler
npm run dev:web    # http://localhost:5173 — client with a dev proxy
```

An empty database serves an empty map. To fill it see [ingest.md](ingest.md);
the short version is `npm run ig:login --workspace @wheresthefx/ingest`
once, then `npm run scrape --workspace @wheresthefx/ingest`.

## Verifying

```bash
npm run check
```

One command, and the only one that matters before a push. It runs, in
order: the naming gate, the copy gate, the class gate, ESLint, typecheck
across every workspace, the test suite, and a production build of the
client.

The build is part of the gate deliberately. Lint and typecheck both pass
on a bundle that will not build — a Node-only module reached the browser
through a shared package, `vite build` failed, and the deployed site kept
running on a stale `dist/` while the source was edited.

`npm run lint:lock` is separate and not in `check`: it is the exact check
the server runs (`npm ci` refuses to install when `package.json` and the
lockfile disagree), and it costs a network round trip.

## Environment

Copy `.env.example` to `.env`.

| Variable | Description | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/wheresthefx` |
| `JWT_SECRET` | **Required.** 32+ chars. Startup fails without it. | none |
| `PORT` | API port | `3001` |
| `NODE_ENV` | `production` tightens CORS to `CORS_ORIGIN` only | unset |
| `CORS_ORIGIN` | Allowed origins, comma-separated. Unused in production, where the client is same-origin. | `http://localhost:5173` |
| `CLIENT_DIST` | Built client to serve | `../../web/dist` |
| `VITE_API_URL` | API base URL compiled into the client | `http://localhost:3001` |
| `VITE_DEV_API_TARGET` | Where the dev server proxies `/api` | `http://localhost:3001` |
| `IG_USERNAME` | Instagram account for the scraper | none |
| `IG_PASSWORD` | Password for that account | none |
| `IG_SESSION_PATH` | Where the logged-in session is cached | `./data/session/ig-session.json` |
| `IG_PROXY_URL` | Optional proxy for scraping | none |
| `EXTRACT_BASE_URL` | OpenAI-compatible endpoint | `https://api.openai.com/v1` |
| `EXTRACT_API_KEY` | Key for that endpoint. `OPENAI_API_KEY` is accepted as a fallback. | none |
| `EXTRACT_MODEL` | Extraction model | `gpt-4.1-mini` |
| `INGEST_INTERVAL_HOUR` | Hours between scheduled scrapes | `6` |
| `INGEST_INITIAL_DELAY_MINUTE` | Delay before the first scrape after boot | `5` |
| `GEOCODE_CONTACT` | Contact address sent to Nominatim, as its usage policy requires | none |
| `BLEAD_DB_PATH` | Recovered SQLite snapshot, for the one-off import commands only | `./data/ig-events.db` |
| `BLEAD_IMAGES_PATH` | Local image cache, if present | none — the proxy falls back to the CDN |

## Project structure

Directory names are singular, per [CONVENTIONS.md](CONVENTIONS.md).

```
wheresthefx/
├── app/
│   ├── api/                      # Express 5 — API, static client, scheduler
│   │   └── src/
│   │       ├── lib/              # param parsing, DTOs, SSRF + freshness guards
│   │       ├── middleware/       # JWT auth
│   │       ├── route/            # event, venue, category, auth, user
│   │       ├── scheduler.ts      # in-process ingest timer (replaces cron)
│   │       └── index.ts          # entry, image proxy, health, SPA fallback
│   └── web/                      # Vite + React client
│       └── src/
│           ├── api/client.ts
│           ├── component/        # event, badge, map, ui
│           ├── constant/         # category colours
│           ├── page/             # Index (map), Auth, NotFound
│           └── util/             # cluster, markerIcon, smoothWheelZoom, dateRange
├── package/
│   ├── core/                     # contracts both sides must agree on
│   │   └── src/                  # category taxonomy, Manila time, repo root
│   ├── db/                       # Drizzle schema + versioned migration
│   └── ingest/                   # scrape, extract, geocode, store
│       ├── fixture/              # venue aliases, OSM gazetteer, golden set
│       ├── script/               # one-off data builders
│       └── src/
│           ├── command/          # every runnable entry point
│           ├── extractor/        # model backend, prefilter, response parsing
│           ├── geocode/          # Nominatim client with bounds guards
│           ├── identity/         # event hash, similarity, review tier
│           ├── prompt/           # the versioned extraction prompt
│           ├── scraper/          # Playwright + Instagram private API
│           └── store/            # account, event, post, venue, cost, sync
├── script/                       # deploy + the three lint gates
└── docs/
```

### Why the shared packages exist

`package/db` holds the only copy of the schema. The API and the ingest
each kept their own, which is how the ingest came to write ~20 columns
that did not exist — Drizzle discards unknown keys silently, so it looked
like it was working while writing NULLs.

`package/core` holds anything both sides must agree on. The category
taxonomy lived in three places with three different value sets, and the
sync between them collapsed five of the twelve categories to `other` on
every run.

`findRepoRoot` is exported from `@wheresthefx/core/repo`, not from the
package index: it reads the filesystem, and the index is bundled into the
browser.

## How data arrives

```
Instagram  ──►  scraper (Playwright + private v1 feed)
                    │
                    ▼
              prefilter — drops what is demonstrably not an event
                    │
                    ▼
              extraction — OpenAI-compatible, versioned prompt, system/user split
                    │
                    ▼
              parse + guard — bounded dates, prices, venues, categories
                    │
                    ▼
              store — content-hash dedup, then a fuzzy tier
                    │
                    ▼
              geocode — Nominatim, inside the run, bounded to Metro Manila
```

The scheduler in `app/api` runs this every `INGEST_INTERVAL_HOUR` hours,
in-process. There is no cron.

Each pass takes the accounts least recently scraped, up to `--limit` (the
scheduler passes 40), skipping any scraped within the last 20 hours. A
full sweep of the ~200-account watchlist therefore takes about a day.

## API

Every endpoint is under `/api`. See [api.md](api.md) for request and
response shapes.

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/auth/register`, `/auth/login` | no |
| `GET` | `/auth/me` | yes |
| `GET` | `/events`, `/events/upcoming`, `/events/map`, `/events/:id` | optional |
| `GET` | `/venues`, `/venues/:id`, `/venues/:id/events` | no |
| `GET` | `/categories` | no |
| `GET`, `POST` | `/users/me/saved` | yes |
| `GET`, `PUT` | `/users/me/preferences` | yes |
| `GET` | `/images/proxy?url=…&shortcode=…` | no |
| `GET` | `/health` | no |

`/health` reports database reachability and ingest freshness. It is the
monitor whose absence let the pipeline sit dead for months.

## Database

Nine tables. [schema.md](schema.md) is the reference and
`package/db/src/schema.ts` is the source of truth:
`venue`, `source_account`, `source_post`, `event`, `sub_event`,
`account`, `saved_event`, `account_preference`, `sync_log`.

## Deployment

```bash
./script/deploy.sh
```

Runs `npm run check`, ships the whole source tree, builds the client on
the host from what just landed, restarts under pm2, and fails loudly if
the health check is not 200. `.env` and `data/` are excluded — they hold
the live credentials and the Instagram session. Pass `--skip-check` when
you have just run the gate.

Production is a single pm2 process behind nginx, with Let's Encrypt
covering both `wheresthefx.com` and `www.wheresthefx.com`. The apex
redirects to `www`.

## Tech stack

| Layer | Technology |
| --- | --- |
| Client | React 18, Vite, TypeScript, Tailwind, shadcn/ui |
| Map | Leaflet, dark CARTO basemap, SVG markers, smooth wheel zoom |
| API | Express 5, TypeScript |
| ORM | Drizzle |
| Database | PostgreSQL |
| Auth | JWT + bcrypt |
| Scraping | Playwright + fingerprint-injector |
| Extraction | OpenAI-compatible chat completions |
| Geocoding | Nominatim |
| Process | pm2, nginx |
