# The tripi bridge

How this repo feeds [tripitropi.com](https://tripitropi.com), and what tripi has to change to
accept it.

## What tripi wants from here

tripi plans a gala for a group of friends: everyone drops in a class schedule, it solves for the
days they can all go out, then builds an itinerary from a catalog of places. That catalog is
filled by bulk ingest from open datasets — OSM via Overpass, Foursquare OS Places, Overture.

Those datasets can tell tripi that a bar exists. They cannot tell it there is a night market in
Poblacion this Friday. **That is the whole of what this repo adds**, and it is the half that
matters for picking a day: tripi already knows which days the crew is free, and this says what is
on. Everything below exists to get dated Metro Manila events into tripi's planner without either
repo importing the other.

## The two drafts

| Draft | Maps to | Ingestable today |
|---|---|---|
| `PlaceDraft` | tripi `place`, public layer (`crew_id IS NULL`) | Yes, after one enum value |
| `EventDraft` | a table tripi does not have yet | No, needs a tripi migration |

Both live in [`package/core/src/tripi.ts`](../package/core/src/tripi.ts) with 25 tests beside
them. `package/core` is pure — no database, no Express, no React, no DOM — which is what makes it
the tree tripi can read without inheriting this repo's stack.

### PlaceDraft

Structurally identical to tripi's `PoiDraft` (`apps/api/src/service/poi.ts`), with `source`
pinned to `'wheresthefx'`. Field names and nullability match tripi's `place` columns exactly, so
its ingest inserts without a translation step — which is the class of bug a translation step
exists to create.

```ts
interface PlaceDraft {
  source: 'wheresthefx';
  name: string | null;
  area_name: string | null;
  address_line: string | null;
  category_tag: string[];      // singular key holding an array, per rule 22
  latitude: number | null;
  longitude: number | null;
  external_ref: string | null; // "venue/19"
  confidence: number | null;
  skip_reason: string | null;
}
```

### EventDraft

`PlaceDraft` plus the dated fields, because an event's venue **is** a place and tripi wants the
place row either way: ingesting an event should fill the catalog as a side effect, not need a
second pass.

```ts
interface EventDraft extends PlaceDraft {
  event_date: string;              // YYYY-MM-DD, Manila local
  event_end_date: string | null;
  start_time: string | null;       // HH:MM 24-hour, Manila local
  end_time: string | null;
  title: string;
  price_band: number | null;       // 1..3, tripi's ₱/₱₱/₱₱₱
  is_free: boolean;
  category: string;                // closed set, so tripi can filter without parsing tags
  source_url: string | null;       // where a human verifies a machine-extracted claim
}
```

## What tripi has to change

### To ingest places: one line

```sql
ALTER TYPE place_source ADD VALUE IF NOT EXISTS 'wheresthefx';
```

The same one-line change tripi has already made six times — `tiktok` and `instagram` (migration
017), `foursquare` and `overture` (025), `airbnb` (040), `blog` (058). Then a feed arm in
`script/ingest-place.ts` alongside `osm`/`fsq`/`overture` that reads this repo's JSON instead of
a CSV, and the existing path does the rest: raw payload to `place_ingest`, normalized draft
upserted into `place` on `(source, external_ref)`, crew-private rows never touched.

### To ingest events: a table

tripi's `place` has no date column, on purpose — a place is a place. A dated occurrence needs
somewhere to live. The shape the drafts above assume:

```sql
CREATE TABLE place_event (
  place_event_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id        uuid NOT NULL REFERENCES place(place_id) ON DELETE CASCADE,
  source          place_source NOT NULL,
  external_ref    text NOT NULL,
  title           text NOT NULL,
  event_date      date NOT NULL,
  event_end_date  date,
  start_minute    smallint,          -- tripi's in-day convention, 0..1440
  end_minute      smallint,
  price_band      smallint,
  is_free         boolean NOT NULL DEFAULT false,
  category_tag    text[] NOT NULL DEFAULT '{}',
  source_url      text,
  confidence      numeric(3,2),
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  deleted_at      timestamptz,

  CONSTRAINT place_event_once UNIQUE (source, external_ref)
);
```

Two deliberate translations at the boundary, which this repo does **not** do for tripi:

- **`HH:MM` → `start_minute`.** tripi stores minutes-from-local-midnight (0..1440) for anything
  inside a day, and 1440 means end-of-day. This feed emits `HH:MM` because that is what the
  extractor produced and what every other consumer here reads. tripi's ingest converts.
- **`event_date` stays a `date`.** A calendar day has no instant. tripi already sets the `pg`
  type parser for OID 1082 so `date` arrives as `'YYYY-MM-DD'` rather than a `Date` built in the
  server's zone, which is how you get an off-by-one for anyone west of UTC.

## The feed

Two ways to read it. Both produce the same envelope.

```bash
# steady state: pull
curl 'localhost:3001/api/export/place-draft'
curl 'localhost:3001/api/export/event-draft?since=2026-08-01'

# first load, or when tripi's ingest host cannot reach this API
npm run export:tripi -- place
npm run export:tripi -- event --since 2026-08-01
npm run export:tripi -- event --jsonl        # one draft per line
npm run export:tripi -- place --skipped      # only what was NOT emitted, and why
```

Envelope:

```json
{
  "source": "wheresthefx",
  "version": 1,
  "exported_at": "2026-07-26T02:00:00.000Z",
  "draft": [ /* ... */ ],
  "draft_count": 1,
  "skipped": [ { "external_ref": "venue/20", "skip_reason": "no name" } ]
}
```

`version` is `TRIPI_DRAFT_VERSION`. Bump it on any breaking shape change so a stale consumer
fails loudly rather than silently mis-reading a field.

### Why a pull feed and not a push

tripi already has a bulk ingest command per source that reads a feed, records the raw payload,
and upserts. A pull endpoint drops straight into that shape: no credentials on this side, no
delivery retry, no knowledge of tripi's schedule. Pushing would mean this repo owning a queue to
solve a problem tripi's ingest already solves.

### Skips are reported, not silent

A draft that cannot become a place is still emitted, carrying a `skip_reason`, and the envelope
separates it out. This mirrors tripi's own rule: `place_ingest` keeps the raw payload with a
`skip_reason` so "why is this spot missing" has an answer in the database rather than in a lost
log. Filtering at the source would defeat that.

Current reasons, in the order they are checked:

| Draft | `skip_reason` | Why it is fatal |
|---|---|---|
| place | `no name` | tripi's catalog dedupe key is `(name, area)` |
| place | `no coordinate` | nothing to route to, which is the point of an itinerary |
| event | `no date` | the one failure that makes it useless for picking a day |
| event | `no title` | nothing to show a crew |
| event | `no venue name` | see `no name` |
| event | `no coordinate` | see above |

## Mapping decisions worth knowing

**Area name falls back to `Metro Manila`.** tripi dedupes its public catalog on
`(lower(name), lower(coalesce(area_name, '')))`, so a null area is not a cosmetic gap — it
collapses every unplaced venue in the country into one dedupe bucket. This repo only indexes
Metro Manila, so naming it is honest rather than a guess, and it is the same move tripi's OSM
feed makes with `--area`.

**A place is named after the venue, never the event.** Otherwise every night at the same bar
mints another catalog row.

**Category maps to natural words, not enum-speak.** tripi's place search is `pg_trgm` over the
name plus `category_tag`, so a crew searching "live music" should hit. `music` alone would not.
Tags are lowercased, deduped, and capped at 8 — tripi's own `CATEGORY_TAG_CAP`.

**Price bands are set against Manila event pricing**, not restaurant covers: up to ₱500 is a
normal gig door charge, ₱500–1500 a ticketed show, above that a concert or festival pass. Free is
band 1, not 0 — tripi's `CHECK` is `BETWEEN 1 AND 3`, and free is genuinely the cheapest band.
**Unknown stays null**, because guessing "cheap" for a price nobody extracted is the one error
that costs a student money.

**Venue confidence is null, not 1.0.** There is no prominence signal for a venue on this side,
and a made-up 1.0 would outrank Overture's real confidence scores in any ranking tripi applies.
Event drafts do pass the extractor's confidence through, since that number means something.

**Events are filtered to what belongs in an itinerary**: `event_date >= today in Manila`,
`event_status = 'confirmed'`, `review_tier <> 'rejected'`. Manila local rather than UTC because
for the first eight hours of every Manila day UTC still reads as yesterday, and would serve a
night that has already ended.

## Keeping the two repos in step

The repos share no code and no database. What they share is a set of conventions, so that code
moves between them by hand without a rewrite:

- **The naming gate is the same gate.** [`script/validate-naming.ts`](../script/validate-naming.ts)
  is a superset of tripi's: the SQL and collection rules are byte-compatible, so a violation
  means the same thing in both repos. This repo adds three checks tripi does not need — Drizzle
  property names, directory names, and ORM imports in routes.
- **The copy gate is tripi's, unchanged** apart from `SCAN_ROOT`, so a string that passes here
  passes there.
- **Layering matches.** tripi has no ORM: routes call `src/db/`, services are pure. This repo
  keeps Drizzle but confines it behind the same boundary, so mapping logic ports unchanged and
  only the query has to be rewritten. `npm run lint:naming` enforces the route half.
- **The contract lives here, because this is the side that changes.** If the taxonomy grows a
  13th category or the price bands move, the mapping moves in the same commit. tripi consumes a
  versioned artefact and never imports from this repo.

## Files

| | |
|---|---|
| [`package/core/src/tripi.ts`](../package/core/src/tripi.ts) | the contract, the mappers, the category and price tables |
| [`package/core/src/tripi.test.ts`](../package/core/src/tripi.test.ts) | 25 tests, including every skip reason |
| [`package/core/src/geo.ts`](../package/core/src/geo.ts) | haversine, coordinate coercion, proximity clustering — shared, pure |
| [`app/api/src/db/tripiExport.ts`](../app/api/src/db/tripiExport.ts) | the only SQL behind the feed |
| [`app/api/src/routes/export.ts`](../app/api/src/routes/export.ts) | HTTP only |
| [`app/api/src/scripts/export-tripi.ts`](../app/api/src/scripts/export-tripi.ts) | the CLI |
