# Changelog

Notable changes to WheresTheFX. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Current state lives in [docs/README.md](docs/README.md); this file is the
history.

## [Unreleased] — revival

The product had been dormant since March 2026. The API served 11 events,
4 of them upcoming; the pipeline that fed it had stopped; the repo did
not build, lint, or have a single test. This entry covers bringing it
back.

### Added

- **In-house ingestion.** The Instagram scraper, AI extraction, geocoding
  and storage now live in `package/ingest` and write to PostgreSQL
  directly. The previous path scraped into SQLite on another machine and
  rsynced it across. See [docs/ingest.md](docs/ingest.md).
- **Versioned extraction prompt** with `PROMPT_VERSION` persisted per
  row, so a quality regression can be traced to the prompt that caused
  it. Currently `4.2.0`.
- **In-process scheduler** (`app/api/src/scheduler.ts`) replacing cron.
- **Cost metering** with per-model pricing. Extraction spend measured at
  $0.0025/post; skipping already-extracted posts cut a projected
  $435/month to under $15.
- **OpenStreetMap gazetteer** — ~13,500 named Metro Manila venues in
  `package/ingest/fixture/osm-venue.json`, used as an independent second
  opinion on coordinates.
- **Health check that touches the database** and reports ingest
  freshness. Its absence is why a four-month outage went unnoticed.
- **Test suite**: 308 tests across 20 files, from zero.
- **Three lint gates** — naming, copy, and class — each catching a class
  of mistake that is silent to TypeScript and ESLint.
- **`script/deploy.sh`** — one operation: gate, ship, build on the host,
  restart, verify.
- **Smooth wheel and trackpad zoom** on the map, ported from tripi.
- **Fourteen ingest commands** for auditing and repairing the data, each
  with `--dry-run`.

### Changed

- **Restructured into an npm workspace monorepo** (`app/*`, `package/*`)
  with `strict: true`, ESLint, and a green build gate. The schema now has
  exactly one copy, in `package/db`.
- **Collapsed to a single process.** The API serves the built client from
  the same origin, so there is no CORS in production and no second
  deploy to keep in step.
- **Replaced the `snakeCaseResponse` middleware with explicit DTOs.** The
  middleware was not injective and derived the public contract from
  whatever the ORM returned.
- **Primary keys renamed** to `{table}_id` throughout, enforced by the
  naming gate.
- **The map fits to its events** instead of opening on a hardcoded Quezon
  City point, trimming outliers so one provincial pin cannot zoom the
  view out to the whole archipelago.
- **Markers redrawn as SVG.** They were a middle-finger PNG rotated 180
  degrees and recoloured by thirteen hand-tuned CSS filter chains.
- **Categories**: the canonical twelve now live in `package/core`. The
  old sync collapsed five of them to `other` on every run.

### Fixed

- **Prompt injection.** A caption reading "ignore previous instructions"
  could set `isFree` and rewrite the title. The prompt is now a
  `{ system, user }` pair — rules trusted, caption not.
- **Unauthenticated SSRF and arbitrary file read** in the image proxy.
- **Broken user endpoints.** Every logged-in feature 404'd: the client
  called `/api/users/me/*` and the server served `/api/users/*`.
- **The map could not be dragged.** `pointer-event-none` — singular —
  left an invisible overlay intercepting every click. The typo appeared
  eighteen times across ten files.
- **The entry screen was illegible.** It hardcoded a white background
  while the dark theme was active, so every token resolved to light grey
  on white.
- **Every share rendered the scaffolding vendor's branding.** `og:image`
  and `twitter:image` pointed at lovable.dev; the favicon was hot-linked
  to a gpt-engineer bucket.
- **UTC-versus-Manila dates.** "Today" was computed in UTC, so for the
  first eight hours of every Manila day the API served yesterday.
- **The scheduler had never run once.** It resolved its working directory
  against the cwd, which under pm2 is `/`, and logged success on failure.
- **`.env` was tracked.** `.gitignore` had listed it since the initial
  commit, but the file was already tracked so the ignore never applied.
- **Smart-quote handling** in `eventHash` and venue normalisation. The
  character class looked like it covered smart quotes and contained the
  same straight apostrophe four times, so "Mow's Bar" and "Mow’s Bar"
  became different venues and duplicate events.
- **The prefilter dropped 42.7% of real events.** Rebuilt as
  anti-signal-only after measuring against 5,652 captions.

### Data

- Re-extracted the recovered snapshot with the current prompt: 5,183
  posts, 2,680 events, 0 failures, **$12.97**.
- Venue directory: **361 → 325 rows**, duplicates folded, idempotent.
- Duplicate events: **541 rows removed** across 268 clusters.
- Corrected two badly misplaced venues — 19 East was pinned in Bel-Air
  rather than Sucat, Nokal in a Makati Square parking basement rather
  than Poblacion. 94 events moved.
- Removed `pacnewport` from the watchlist: the Performing Arts Center in
  Newport, **Oregon**. Its venue name collided with the real one in
  Pasay, so 23 Oregon events were showing at a Pasay address.
- Production went from **4 upcoming events and 4 map pins** to **~155
  upcoming and ~97 pins**.

### Known gaps

- The map is still behind an arithmetic puzzle labelled "age
  verification". It gates on numeracy, gives no legal cover, and stops
  no minors.
- 78 of ~155 upcoming events have no coordinate, so `/api/events/upcoming`
  returns things that cannot be placed on a map.
- No integration tests over the HTTP routes; auth boundaries are
  untested.
- April–June 2026 has thin coverage. That is when the pipeline was dead,
  and those posts have scrolled out of Instagram's reachable window.
- The extraction prompt's venue-list fix (4.2.0) has not yet been
  measured against a controlled sample.
- Monetization seams (promotion table, ranking, impression tracking) are
  designed but not built.
