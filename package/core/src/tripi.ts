/**
 * The tripi bridge — what this repo hands to tripitropi.com as one of its catalog sources.
 *
 * ## What tripi is and why it wants this
 *
 * tripi plans a gala for a group of friends: everyone drops in a class schedule, it solves for
 * the days they can all go out, then builds an itinerary from a catalog of places. That catalog
 * is filled by bulk ingest (`npm run ingest:place -- osm|fsq|overture`), which normalizes every
 * upstream record into a `PoiDraft` and upserts it into the PUBLIC layer of `place` -- the rows
 * where `crew_id IS NULL`, per tripi's migration 028. Raw payloads land beside them in
 * `place_ingest` with a `skip_reason` when a record never became a place.
 *
 * Open datasets tell tripi that a bar exists. They cannot tell it that there is a night market
 * in Poblacion this Friday. That is the whole of what this repo adds, and it is the half that
 * actually matters for picking a *day*: tripi already knows which days the crew is free, and
 * this says what is on.
 *
 * ## Two drafts, two different amounts of work on the tripi side
 *
 * `PlaceDraft` is ingestable today. It is byte-compatible with tripi's `PoiDraft` apart from
 * the `source` value, so the only tripi-side change is one enum value:
 *
 *   ALTER TYPE place_source ADD VALUE IF NOT EXISTS 'wheresthefx';
 *
 * which is the same one-line change tripi has already made six times (tiktok, instagram,
 * foursquare, overture, airbnb, blog -- migrations 017/025/040/058).
 *
 * `EventDraft` is NOT ingestable today. tripi's `place` has no date column, on purpose: a place
 * is a place. A dated occurrence needs a table tripi does not have yet. The contract is defined
 * here anyway so the tripi-side migration has something exact to build against rather than
 * being reverse-engineered off a JSON dump. See docs/TRIPI.md for the proposed schema.
 *
 * ## Why the contract lives in this repo
 *
 * Because this is the side that changes. If the taxonomy grows a 13th category or the price
 * bands move, the mapping has to move with it, and it should move in the same commit. tripi
 * consumes a versioned artefact and never imports from here.
 */

/**
 * The `place_source` value tripi must accept for anything this repo emits.
 *
 * A single literal, not a union: this repo is exactly one source. The variety upstream
 * (Instagram accounts, venue pages) is this repo's business, not tripi's -- collapsing it to
 * one source value is what lets tripi's `(source, external_ref)` unique index do its job.
 */
export const TRIPI_SOURCE = 'wheresthefx';

/** Contract version, stamped on every export envelope. Bump on any breaking shape change. */
export const TRIPI_DRAFT_VERSION = 1;

/**
 * Structurally identical to tripi's `PoiDraft` (`apps/api/src/service/poi.ts`), with `source`
 * pinned. Field names and nullability match tripi's `place` columns exactly, so the ingest can
 * insert without a translation step -- the class of bug a translation step exists to create.
 */
export interface PlaceDraft {
  source: typeof TRIPI_SOURCE;
  name: string | null;
  area_name: string | null;
  address_line: string | null;
  /** Free tags, lowercased, deduped, capped. Singular key holding an array, per rule 22. */
  category_tag: string[];
  latitude: number | null;
  longitude: number | null;
  /** Stable upstream id, so re-ingesting updates in place instead of duplicating. */
  external_ref: string | null;
  /** Upstream prominence 0..1. Null where this repo has no basis for a number. */
  confidence: number | null;
  /** Set when the record must not become a place. Recorded beside the raw payload. */
  skip_reason: string | null;
}

/**
 * A dated thing happening at a place.
 *
 * Extends `PlaceDraft` rather than sitting beside it because an event's venue IS a place and
 * tripi will want the place row either way: ingesting an event should fill the catalog as a
 * side effect, not require a second pass.
 */
export interface EventDraft extends PlaceDraft {
  /** `YYYY-MM-DD` in Manila local time. Never an instant -- a calendar day has no instant. */
  event_date: string;
  /** `YYYY-MM-DD`, for something spanning days. Null when it is a single day. */
  event_end_date: string | null;
  /** `HH:MM` 24-hour, Manila local. Null when the source never said. */
  start_time: string | null;
  end_time: string | null;
  title: string;
  /** 1..3, rendered ₱/₱₱/₱₱₱ by tripi. Null means unknown, which is not the same as cheap. */
  price_band: number | null;
  is_free: boolean;
  /** Canonical wheresthefx category. Kept alongside `category_tag` so tripi can filter on a
   *  closed set rather than parsing free tags. */
  category: string;
  /** Where a human can verify this, since everything here is machine-extracted. */
  source_url: string | null;
}

/** Envelope every export is wrapped in, so a consumer can tell what it is holding. */
export interface DraftExport<T> {
  source: typeof TRIPI_SOURCE;
  version: number;
  /** When the export ran, ISO 8601 with offset. */
  exported_at: string;
  draft: T[];
  draft_count: number;
  /** Records that were deliberately not emitted, with why. Mirrors `place_ingest.skip_reason`. */
  skipped: { external_ref: string; skip_reason: string }[];
}

// ---------------------------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------------------------

/**
 * wheresthefx category → tripi `category_tag` values.
 *
 * tripi's tags are free lowercase text: its OSM feed emits raw tag values (`cafe`, `bar`,
 * `music_venue`) and its CSV feeds emit lowercased Foursquare breadcrumb leaves. Its place
 * search is `pg_trgm` over the name plus these tags, so natural words beat enum-speak -- a
 * crew searching "live music" should hit, and `music` alone would not.
 *
 * Tags are singular where the noun is countable (`market`, `workshop`), matching the house
 * rule rather than the category label's plural.
 */
const TRIPI_CATEGORY_TAG: Record<string, string[]> = {
  nightlife: ['nightlife', 'bar', 'club'],
  music: ['live music', 'music venue', 'gig'],
  arts: ['arts', 'gallery', 'exhibit'],
  film: ['film', 'cinema', 'screening'],
  comedy: ['comedy', 'standup'],
  food: ['food', 'restaurant', 'cafe'],
  markets: ['market', 'bazaar', 'pop up'],
  sports: ['sports', 'game'],
  fitness: ['fitness', 'run', 'class'],
  workshops: ['workshop', 'class'],
  tech: ['tech', 'meetup'],
  community: ['community', 'meetup'],
};

/** Same cap tripi applies, so a draft can never overflow what it is willing to store. */
const CATEGORY_TAG_CAP = 8;

/**
 * Tags for a category, plus whatever extra the caller has (a venue's own category text, an
 * artist name). Lowercased, trimmed, deduped, capped -- exactly tripi's `splitCategoryLabel`
 * normalisation, so tags arriving from here look like tags arriving from anywhere else.
 */
export function toTripiCategoryTag(category: string | null, extra: readonly (string | null)[] = []): string[] {
  const base = category === null ? [] : TRIPI_CATEGORY_TAG[category] ?? [category];
  const tag: string[] = [];
  for (const raw of [...base, ...extra]) {
    const clean = (raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (clean === '') continue;
    if (tag.includes(clean)) continue;
    tag.push(clean);
    if (tag.length === CATEGORY_TAG_CAP) break;
  }
  return tag;
}

// ---------------------------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------------------------

/**
 * Peso ticket price → tripi's 1..3 price band.
 *
 * The bands are read as ₱/₱₱/₱₱₱ by a student deciding whether a night out is affordable, so
 * the thresholds are set against Metro Manila event pricing rather than restaurant covers:
 * up to ₱500 is a normal gig door charge, ₱500-1500 is a ticketed show, above that is a
 * concert or a festival day pass.
 *
 * Free is band 1, not band 0 -- tripi's CHECK constraint is `BETWEEN 1 AND 3` and free is
 * genuinely the cheapest band, not a fourth kind of thing. Unknown stays null, because
 * guessing "cheap" for a price nobody extracted is the one error that actually costs money.
 */
export function toTripiPriceBand(input: {
  is_free?: boolean | null;
  price?: number | null;
  price_min?: number | null;
  price_max?: number | null;
}): number | null {
  if (input.is_free === true) return 1;

  const candidate = [input.price, input.price_min, input.price_max].find(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0,
  );
  if (candidate === undefined) return null;

  if (candidate <= 500) return 1;
  if (candidate <= 1500) return 2;
  return 3;
}

// ---------------------------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------------------------

/**
 * The area every draft falls back to.
 *
 * tripi dedupes its public catalog on `(lower(name), lower(coalesce(area_name, '')))`, so a
 * null area is not a cosmetic gap -- it collapses every unplaced venue in the country into one
 * dedupe bucket. This repo only ever indexes Metro Manila, so naming it is honest rather than a
 * guess, and it is the same move tripi's own OSM feed makes with `--area`.
 */
export const DEFAULT_AREA_NAME = 'Metro Manila';

/** What `toPlaceDraft` needs. Structural, so a DAL row satisfies it without being imported. */
export interface VenueSource {
  venue_id: number;
  name: string | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  category: string | null;
}

/** What `toEventDraft` needs, beyond the venue fields it carries denormalized. */
export interface EventSource {
  event_id: number;
  title: string | null;
  event_date: string | null;
  event_end_date: string | null;
  event_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_lat: number | null;
  venue_lng: number | null;
  city?: string | null;
  category: string | null;
  is_free: boolean | null;
  price: number | null;
  price_min: number | null;
  price_max: number | null;
  /** Extractor confidence 0..1. Passed through as tripi's `confidence`. */
  confidence: number | null;
  source_url: string | null;
}

function tidy(raw: string | null | undefined): string | null {
  const clean = (raw ?? '').replace(/\s+/g, ' ').trim();
  return clean === '' ? null : clean;
}

function boundedCoordinate(value: number | null, bound: number): number | null {
  if (value === null || !Number.isFinite(value) || Math.abs(value) > bound) return null;
  return value;
}

/** `HH:MM` or null. Anything else the extractor produced is dropped rather than passed on. */
function tidyTime(raw: string | null | undefined): string | null {
  const clean = tidy(raw);
  if (clean === null) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(clean);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

/** `YYYY-MM-DD` or null. */
function tidyDate(raw: string | null | undefined): string | null {
  const clean = tidy(raw);
  if (clean === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : null;
}

/**
 * One venue → one tripi place draft.
 *
 * A draft with a `skip_reason` is still returned rather than dropped: tripi records the reason
 * next to the raw payload so "why is this spot missing" has an answer in the database instead
 * of in a lost log. Dropping it here would defeat that.
 */
export function toPlaceDraft(venue: VenueSource, areaName = DEFAULT_AREA_NAME): PlaceDraft {
  const name = tidy(venue.name);
  const latitude = boundedCoordinate(venue.lat, 90);
  const longitude = boundedCoordinate(venue.lng, 180);

  const draft: PlaceDraft = {
    source: TRIPI_SOURCE,
    name,
    area_name: tidy(venue.city) ?? areaName,
    address_line: tidy(venue.address),
    category_tag: toTripiCategoryTag(venue.category),
    latitude,
    longitude,
    external_ref: `venue/${venue.venue_id}`,
    // No prominence signal exists for a venue on this side. Null rather than a made-up 1.0,
    // which would outrank Overture's real confidence scores in any ranking tripi applies.
    confidence: null,
    skip_reason: null,
  };

  // A place with no name cannot be deduped (tripi's catalog key is name+area) and cannot be
  // rendered. A place with no coordinate cannot be routed to, which is the entire point of
  // the itinerary. Either one makes the row useless rather than merely incomplete.
  if (name === null) draft.skip_reason = 'no name';
  else if (latitude === null || longitude === null) draft.skip_reason = 'no coordinate';

  return draft;
}

/**
 * One event → one tripi event draft.
 *
 * Reads the denormalized venue fields on the event rather than joining, because those are what
 * the event was actually extracted with: an event whose `venue_id` resolved to a geocoded venue
 * still carries the coordinate the extractor saw, and disagreeing with it silently would move a
 * pin without saying so.
 */
export function toEventDraft(event: EventSource, areaName = DEFAULT_AREA_NAME): EventDraft {
  const title = tidy(event.title);
  const venueName = tidy(event.venue_name);
  const eventDate = tidyDate(event.event_date);
  const latitude = boundedCoordinate(event.venue_lat, 90);
  const longitude = boundedCoordinate(event.venue_lng, 180);

  const draft: EventDraft = {
    source: TRIPI_SOURCE,
    // The place is the venue; the event's own title is carried separately. Naming the place
    // after the event would mint a new catalog row per night at the same bar.
    name: venueName,
    area_name: tidy(event.city) ?? areaName,
    address_line: tidy(event.venue_address),
    category_tag: toTripiCategoryTag(event.category),
    latitude,
    longitude,
    external_ref: `event/${event.event_id}`,
    confidence:
      typeof event.confidence === 'number' && event.confidence >= 0 && event.confidence <= 1
        ? event.confidence
        : null,
    skip_reason: null,
    title: title ?? '',
    event_date: eventDate ?? '',
    event_end_date: tidyDate(event.event_end_date),
    start_time: tidyTime(event.event_time),
    end_time: tidyTime(event.end_time),
    price_band: toTripiPriceBand(event),
    is_free: event.is_free === true,
    category: event.category ?? '',
    source_url: tidy(event.source_url),
  };

  // Order matters: a dateless event is the one failure that makes it useless for picking a
  // day, which is the only reason tripi wants this feed at all. Report that first.
  if (eventDate === null) draft.skip_reason = 'no date';
  else if (title === null) draft.skip_reason = 'no title';
  else if (venueName === null) draft.skip_reason = 'no venue name';
  else if (latitude === null || longitude === null) draft.skip_reason = 'no coordinate';

  return draft;
}

/** Wrap drafts in the export envelope, splitting out anything carrying a `skip_reason`. */
export function toDraftExport<T extends PlaceDraft>(draft: T[], exportedAt: Date): DraftExport<T> {
  const keep: T[] = [];
  const skipped: { external_ref: string; skip_reason: string }[] = [];

  for (const one of draft) {
    if (one.skip_reason === null) keep.push(one);
    else skipped.push({ external_ref: one.external_ref ?? '', skip_reason: one.skip_reason });
  }

  return {
    source: TRIPI_SOURCE,
    version: TRIPI_DRAFT_VERSION,
    exported_at: exportedAt.toISOString(),
    draft: keep,
    draft_count: keep.length,
    skipped,
  };
}
