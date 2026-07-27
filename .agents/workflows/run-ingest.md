---
description: How to run the in-house Instagram ingest pipeline
---

# Run the ingest pipeline

Scrapes Instagram, extracts events with the versioned prompt, geocodes,
and writes to PostgreSQL. It runs itself every `INGEST_INTERVAL_HOUR`
hours inside the API process — this is how to run it by hand.

Full detail in [docs/ingest.md](../../docs/ingest.md).

## Prerequisites

- PostgreSQL reachable via `DATABASE_URL`
- Migrations applied: `npm run db:migrate`
- `EXTRACT_API_KEY` set, and `GEOCODE_CONTACT` if geocoding
- A cached Instagram session (below)

## Log in once

The login is human-in-the-loop on purpose. It is the step most likely to
hit a checkpoint, and automating it makes that failure silent.

```bash
npm run ig:login --workspace @wheresthefx/ingest
```

A browser opens; sign in; the session is cached at `IG_SESSION_PATH`.
That file is a live credential and is gitignored.

## Scrape

```bash
# See what it would do, without spending anything or writing rows.
npm run scrape --workspace @wheresthefx/ingest -- --limit 5 --dry-run

# For real.
npm run scrape --workspace @wheresthefx/ingest -- --limit 40
```

`--limit` counts accounts, not posts. Each pass takes the accounts least
recently scraped and skips any scraped in the last 20 hours, so running
it twice in a row is close to a no-op.

## Check the run

```bash
psql "$DATABASE_URL" -c "
  SELECT sync_log_id, status, started_at, completed_at,
         post_synced_count, event_synced_count, error_count
  FROM sync_log ORDER BY sync_log_id DESC LIMIT 3;"
```

A run killed by a restart stays `running` forever, which the health check
reads as "a sync is in progress". Mark abandoned rows `failed` rather
than deleting them.

## Audit afterwards

These report and never write:

```bash
npx tsx package/ingest/src/command/audit-duplicate.ts
npx tsx package/ingest/src/command/verify-venue-pin.ts
npx tsx package/ingest/src/command/audit-watchlist.ts
```

The repair commands all take `--dry-run`. Read the dry run before
applying — every guard in them exists because a dry run caught the code
getting something wrong.
