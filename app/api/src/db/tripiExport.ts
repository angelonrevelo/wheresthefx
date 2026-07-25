/**
 * The only SQL behind the tripi export.
 *
 * ## Why this file exists at all
 *
 * Routes in this repo still query Drizzle directly, which is the layering `docs/CONVENTIONS.md`
 * has had on its deferred list since the monorepo landed. Rather than add a fifth route that
 * does it, the export starts on the right side of the line: every statement it needs is here,
 * the route below it is HTTP only, and `package/core` does the mapping with no idea a database
 * exists. `npm run lint:naming` enforces the route half of that.
 *
 * That layering is not tidiness for its own sake -- it is the reason this feed is portable.
 * tripi has no ORM: its routes call `src/db/` and its services are pure. A DAL boundary here
 * means the mapping logic moves between the two repos unchanged and only the query has to be
 * rewritten. See docs/TRIPI.md.
 *
 * ## Row shape
 *
 * Selected into snake_case aliases so a row IS the wire shape, matching tripi's rule that
 * `{Table}Row` interfaces mirror their columns exactly. This is also the single place that
 * bridges the two naming worlds: the Drizzle properties are camelCase (`event.eventDate`,
 * `event.eventId`) while everything downstream of this file is snake_case.
 *
 * That boundary already earned its keep. The `{table}_id` primary-key rename landed while this
 * feed was being written, and it touched five lines -- all of them here. The mapper in
 * `package/core` and the route above it did not change, because neither had ever seen a column
 * name.
 *
 * ## Why the query builder is exported separately from the finder
 *
 * `venueExportQuery`/`eventExportQuery` return the builder; the `find*` wrappers await it. That
 * split exists so `tripiExport.test.ts` can assert on the generated SQL -- the filters and the
 * join -- without a live database. Typecheck already proves every column reference exists, since
 * Drizzle's builder is typed against the schema; what it cannot prove is that the WHERE clause
 * says what the docblock claims, and that is the part worth a test.
 */

import { db, event, sourcePost, venue } from '@wheresthefx/db';
import { and, asc, eq, gte, isNotNull, ne, sql } from 'drizzle-orm';
import { manilaToday, type EventSource, type VenueSource } from '@wheresthefx/core';

/**
 * A venue row in tripi-draft shape.
 *
 * Structurally satisfies `VenueSource` from core, which is how the mapper stays ignorant of
 * Drizzle without either side importing the other.
 */
export type VenueDraftRow = VenueSource;

/** An event row in tripi-draft shape, venue fields joined in. */
export type EventDraftRow = EventSource;

/**
 * Every venue that could become a tripi catalog row.
 *
 * Ungeocoded venues are selected deliberately rather than filtered out: the mapper stamps them
 * `skip_reason: 'no coordinate'` and the export reports them, so "why is this spot missing" has
 * an answer. Filtering here would turn a documented skip into a silent one.
 */
export function venueExportQuery() {
  return db
    .select({
      venue_id: venue.venueId,
      name: venue.name,
      address: venue.address,
      city: venue.city,
      lat: venue.lat,
      lng: venue.lng,
      category: venue.category,
    })
    .from(venue)
    .orderBy(asc(venue.venueId));
}

export async function findVenueForExport(): Promise<VenueDraftRow[]> {
  return venueExportQuery();
}

/**
 * Upcoming events worth handing to a gala planner.
 *
 * Three filters, each of which would otherwise put something misleading in a crew's itinerary:
 *
 * - `event_date >= today in Manila` -- an itinerary cannot include last week. Manila local, not
 *   UTC, because for the first eight hours of every Manila day UTC still reads as yesterday and
 *   would serve a night that has already ended.
 * - `event_status = 'confirmed'` -- a cancelled or postponed event is worse than a missing one.
 * - `review_tier <> 'rejected'` -- rejected rows are extractor false positives, not events.
 *
 * `sinceDate` narrows to events on or after a given day so a consumer can poll without
 * re-reading the whole catalog. It is a floor on `event_date`, not on `updated_at`: a re-poll
 * is meant to be idempotent on tripi's side anyway (it upserts on `(source, external_ref)`),
 * so the useful window is "what is on from this day forward".
 */
export function eventExportQuery(sinceDate?: string) {
  const today = manilaToday();
  const floor = sinceDate !== undefined && sinceDate > today ? sinceDate : today;

  return db
    .select({
      event_id: event.eventId,
      title: event.title,
      event_date: event.eventDate,
      event_end_date: event.eventEndDate,
      event_time: event.eventTime,
      end_time: event.endTime,
      venue_name: event.venueName,
      venue_address: event.venueAddress,
      venue_lat: event.venueLat,
      venue_lng: event.venueLng,
      // The venue's city is the better area name when the join resolved; the mapper falls back
      // to "Metro Manila" when it did not.
      city: venue.city,
      category: event.category,
      is_free: event.isFree,
      price: event.price,
      price_min: event.priceMin,
      price_max: event.priceMax,
      confidence: event.confidence,
      // The Instagram post is where a human checks whether this is real. Everything in this
      // feed is machine-extracted, so a verifiable link is not decoration.
      source_url: sql<string | null>`coalesce(${sourcePost.postUrl}, ${event.signupUrl})`,
    })
    .from(event)
    .leftJoin(venue, eq(event.venueId, venue.venueId))
    .leftJoin(sourcePost, eq(event.sourcePostId, sourcePost.sourcePostId))
    .where(and(
      gte(event.eventDate, floor),
      eq(event.eventStatus, 'confirmed'),
      ne(event.reviewTier, 'rejected'),
      isNotNull(event.eventDate),
    ))
    .orderBy(asc(event.eventDate), asc(event.eventTime));
}

export async function findEventForExport(sinceDate?: string): Promise<EventDraftRow[]> {
  return eventExportQuery(sinceDate);
}
