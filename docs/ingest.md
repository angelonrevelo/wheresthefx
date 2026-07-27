# Ingest pipeline

The pipeline scrapes Instagram directly and writes to PostgreSQL. It runs
in the same process as the API: `app/api/src/scheduler.ts` starts a
scrape every `INGEST_INTERVAL_HOUR` hours. There is no cron, no SQLite
intermediary, and no second machine.

```
Instagram  ──►  scrape  ──►  prefilter  ──►  extract  ──►  parse  ──►  store  ──►  geocode
```

## First run

The scraper needs a logged-in Instagram session. This is deliberately
human-in-the-loop — the login is the step most likely to hit a checkpoint,
and automating it makes that failure silent.

```bash
npm run ig:login --workspace @wheresthefx/ingest
```

That opens a browser, waits for you to sign in, and caches the session at
`IG_SESSION_PATH`. The session is a live credential and is gitignored.

Then:

```bash
npm run scrape --workspace @wheresthefx/ingest -- --limit 40
```

## Stages

### Scrape

`src/scraper/` drives Playwright with `fingerprint-injector` and reads
Instagram's private v1 REST feed. Three tiers, most resilient first; the
GraphQL `doc_id` tier rotates every few weeks and is the fragile one.

Each pass selects the accounts least recently scraped, up to `--limit`,
skipping any scraped within the last 20 hours. With ~200 accounts and the
scheduler's limit of 40, a full sweep takes about a day, and any one
account is checked roughly daily at about 13 posts deep.

### Prefilter

`src/extractor/prefilter.ts` decides whether a caption is worth an
extraction call. It is **anti-signal only**: it drops what is
demonstrably not an event rather than guessing at what is.

An earlier positive-signal version was measured against 5,652 real
captions and dropped 42.7% of genuine events.

### Extract

`src/extractor/backend.ts` speaks OpenAI-compatible chat completions over
plain `fetch`, so the provider is swappable via `EXTRACT_BASE_URL`.

The prompt lives in `src/prompt/extraction.ts` and carries
`PROMPT_VERSION`, persisted per row on `source_post`. It returns a
`{ system, user }` pair: the rules are trusted, the caption is not.
Merging them let a caption reading "ignore previous instructions" set
`isFree` and rewrite the title — reproduced on two models before the
split.

Bump `PROMPT_VERSION` on any change, including a change to the context
rather than the rules. Two runs with different known-venue lists are not
comparable, and telling them apart afterwards is the point of recording a
version.

### Parse

`src/extractor/parse.ts` coerces and bounds every field. Nothing the
model returns is trusted:

- dates outside a plausible window are dropped, not clamped
- a price above ₱50,000 is a phone number
- `price: 0` is not free; `isFree` says free
- an unknown category surfaces as `null` plus the raw string rather than
  being coerced to `other` — silent coercion is how five of twelve
  categories were lost
- a venue that is an Instagram handle, a bare room name, or a caption
  fragment is dropped

### Store

`src/store/event.ts`. Two tiers:

1. **Content hash** — `eventHash(title, date, venue)`. On collision the
   higher completeness score wins. The previous ingest set all values
   unconditionally, so a low-confidence re-scrape overwrote a better row.
2. **Fuzzy** — same date, and either a shared venue at 0.75 title
   similarity or, when one side has no venue, the same source account at
   0.90.

The account comparison falls back to `source_username` when
`source_account_id` is absent, because rows imported from the recovered
snapshot never had an id.

### Geocode

`src/geocode/` calls Nominatim inside the scrape run, rate-limited, and
records `geocode_attempted_at` whether or not it succeeded so permanent
failures stop being retried forever.

It refuses generic names and rejects coordinates outside Metro Manila.
Nominatim answers every question it is asked: given "Activity Center" it
returns a plausible point rather than nothing, which nearly put fourteen
events at an invented location.

## Commands

All under `package/ingest/src/command/`. Every destructive one takes
`--dry-run`, and most were written because a dry run showed something the
code had got wrong.

| Command | Purpose |
| --- | --- |
| `login.ts` | Cache an Instagram session, human-in-the-loop |
| `scrape.ts` | The pipeline. `--limit N`, `--dry-run` |
| `resolve-account.ts` | Cache numeric IG user ids; retire accounts that no longer resolve |
| `reingest.ts` | One-off import of the recovered SQLite snapshot |
| `reextract-legacy.ts` | Re-run extraction over the snapshot's captions with the current prompt |
| `link-orphan-post.ts` | Attach imported posts to their watchlist accounts |
| `merge-alias.ts` | Fold the curated venue aliases into the directory |
| `merge-venue.ts` | Fold duplicate venue rows into one |
| `merge-duplicate.ts` | Fold duplicate events the merge rule accepts |
| `clear-handle-venue.ts` | Repair venue names that are Instagram handles |
| `clear-nonvenue.ts` | Clear venue names that name no venue |
| `verify-venue-pin.ts` | Cross-check coordinates against the OSM gazetteer. Reports only |
| `audit-duplicate.ts` | Report near-duplicate events. Reports only |
| `audit-watchlist.ts` | Report accounts whose events rarely resolve to a venue |

`script/fetch-osm-venue.ts` rebuilds `fixture/osm-venue.json`, a
gazetteer of ~13,500 named Metro Manila venues from OpenStreetMap
Overpass. It is a second opinion on coordinates, not a source of truth:
`verify-venue-pin` reports rather than fixes, because a name match cannot
tell a misplaced venue from an unrelated namesake.

## Cost

`src/store/cost.ts` meters every run. Two mechanisms, in order of what
they save:

1. **Skip already-extracted posts**, keyed on a caption hash so an edited
   post is still re-read. The scraper fetches the last N posts every run
   and almost all were extracted last run. Re-extracting everything every
   pass costs roughly $435/month; skipping brings it under $15.
2. **Prices are recorded per model**, with a fallback rate, so an
   estimate is never silently zero.

Measured: **$0.0025 per post** on `gpt-4.1-mini`. The full 5,183-post
re-extraction of the recovered snapshot cost **$12.97**.

## Sync log

Every run writes to `sync_log`.

| Column | Description |
| --- | --- |
| `started_at`, `completed_at` | Run window |
| `status` | `running`, `completed`, `failed` |
| `account_synced_count` | Accounts visited |
| `post_synced_count` | Posts processed |
| `event_synced_count` | Events written |
| `venue_synced_count` | Venues touched |
| `sub_event_synced_count` | Sub-events written |
| `error_count` | Rows that failed individually |
| `unknown_category_count` | Categories the taxonomy did not recognise |
| `error_message` | Set when `status` is `failed` |

A run killed by a restart leaves `status = 'running'` forever, which the
freshness check reads as "a sync is in progress". Mark abandoned rows
failed rather than deleting them.

## Images

Images are not copied. Events store the Instagram CDN URL, and the client
requests `/api/images/proxy?url=<cdn>&shortcode=<code>`.

The proxy checks a local cache first if `BLEAD_IMAGES_PATH` is set, then
falls back to the CDN. It is hardened: https only, a dot-anchored host
allowlist, no IP literals, `redirect: 'manual'`, an 8MB cap and a
Content-Type allowlist. It was previously an unauthenticated SSRF and an
arbitrary file read.

## Conventions

Database columns are `snake_case`; see [CONVENTIONS.md](CONVENTIONS.md).
API responses are shaped by explicit DTOs in `app/api/src/lib/dto.ts`,
not by a transform middleware — the middleware was not injective
(`imageURL` became `image_u_r_l`) and would have mangled JSONB payloads.
