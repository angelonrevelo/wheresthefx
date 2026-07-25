# Ingest Pipeline: blead → WheresTheFX

## Overview

The ingest pipeline synchronizes data from **blead** (Instagram scraper running on VPS) into the WheresTheFX PostgreSQL database. It's designed to run periodically (every 6 hours) or manually.

## Data Flow

```
blead SQLite (ig-events.db)
  │
  ├─ known_venue   ──→  PostgreSQL venue
  ├─ ig_account    ──→  PostgreSQL source_account
  ├─ ig_post       ──→  PostgreSQL source_post
  ├─ ig_event      ──→  PostgreSQL event
  └─ sub_event     ──→  PostgreSQL sub_event
```

## Deduplication Strategy

Each table uses a **natural key** for dedup (not blead's internal auto-increment IDs):

| Table          | Natural Key  | Strategy                      |
| -------------- | ------------ | ----------------------------- |
| venue          | `name`       | ON CONFLICT DO UPDATE         |
| source_account | `username`   | ON CONFLICT DO UPDATE         |
| source_post    | `shortcode`  | ON CONFLICT DO UPDATE         |
| event          | `event_hash` | ON CONFLICT DO UPDATE         |
| sub_event      | (none)       | DELETE + re-insert per parent |

### Why no dependency on blead IDs?

blead's auto-increment IDs can change if the SQLite database is rebuilt. By matching on natural keys (venue name, IG username, post shortcode, event content hash), the ingest pipeline is resilient to blead database resets.

### event_hash

The `event_hash` is a SHA256 computed by blead from:

- Normalized event title (lowercased, trimmed)
- Event date
- Venue name (lowercased, trimmed)

Two events with the same title, date, and venue are considered duplicates. When a conflict occurs, the record is updated with fresh data.

## Running the Ingest

### Manual (local development)

```bash
BLEAD_DB_PATH=./data/ig-events.db \
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wheresthefx \
npm run ingest --workspace @wheresthefx/api
```

### Cron (production VPS)

```bash
# Every 6 hours. Hours are listed explicitly rather than as a step
# expression so this line can be quoted inside block comments.
0 0,6,12,18 * * * cd /path/to/wheresthefx && \
  npm run ingest --workspace @wheresthefx/api >> /var/log/wheresthefx-ingest.log 2>&1
```

### Via npm script

```bash
npm run ingest --workspace @wheresthefx/api
```

### From blead (local → VPS → production, one command)

```bash
cd /Users/angelonrevelo/Antigravity/blead
bash scripts/ig-events/sync-to-production.sh
```

This rsyncs the local SQLite DB to VPS, runs ingest on VPS, and restarts the API.

## Sync Logging

Every ingest run is logged to the `sync_log` table:

```sql
SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 1;
```

| Column            | Description                         |
| ----------------- | ----------------------------------- |
| started_at        | When the sync started               |
| completed_at      | When it finished                    |
| status            | `running`, `completed`, or `failed` |
| venues_synced     | Number of venues processed          |
| accounts_synced   | Number of accounts processed        |
| posts_synced      | Number of posts processed           |
| events_synced     | Number of events processed          |
| sub_events_synced | Number of sub-events processed      |
| error_message     | Error details if status is `failed` |

## Performance

Typical sync times:

- **118 venues**: ~0.1s
- **157 accounts**: ~0.2s
- **1317 posts**: ~1.5s
- **230 events**: ~0.5s
- **178 sub-events**: ~0.2s
- **Total**: ~3s

## Error Handling

- Failed syncs are logged to `sync_log` with the error message
- The script exits with code 1 on failure (for cron monitoring)
- SQLite is opened in read-only mode (cannot corrupt the source data)

### Known limitations of this script

This is the legacy blead→Postgres bridge. It is being replaced by the
in-house pipeline in `package/ingest`; until then, be aware:

- **There are no transactions.** The docstring claims transactional
  batches; there are none anywhere in the repo. A mid-run failure leaves
  the database half-ingested.
- **Only posts and events have per-row error guards.** Venues, accounts,
  and sub-events abort the whole run on a single bad row — the opposite
  of what this document used to claim.
- **Upserts are blind.** `ON CONFLICT DO UPDATE` sets all values
  unconditionally, so a lower-confidence re-scrape overwrites a better
  record despite the documented "higher completeness_score wins" rule.
- **A destructive dedup pass runs at the end.** `runDedup` hard-`DELETE`s
  fuzzy-matched duplicates, cascading through `saved_event` — a user's
  bookmark disappears when their event loses a match. There is no audit
  trail of what was removed.
- **Geocoding is not wired in.** Newly ingested venues stay unmapped
  until `geocode-venues.ts` is run by hand.

## Image Handling

Images are **not** copied during ingest. Instead:

1. Events store Instagram CDN URLs (`image_url`)
2. The `/api/events/map` and `/api/events` endpoints include `source_post_shortcode` and `source_post_url` from the joined `source_post` table
3. The frontend builds proxy URLs: `/api/images/proxy?url=<cdn_url>&shortcode=<code>`
4. The proxy checks **local cache first** (`BLEAD_IMAGES_PATH/{shortcode}/`) for instant response
5. Falls back to CDN if no local copy exists (with 5s timeout)
6. Local cache responses are cached for 7 days; CDN responses for 24 hours

This avoids duplicating image storage while ensuring images remain accessible even after CDN URLs expire (most do within hours).

## Conventions

- All database columns use `snake_case` — see `docs/CONVENTIONS.md`
- API responses are auto-converted to `snake_case` by `snakeCaseResponse` middleware
