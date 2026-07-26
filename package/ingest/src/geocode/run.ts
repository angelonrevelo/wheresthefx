import { db, event, venue } from '@wheresthefx/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { geocodeVenue } from './nominatim.js';
import { recordGeocode } from '../store/venue.js';

/**
 * Geocode venues that still lack coordinates, then propagate the result
 * to the events that reference them.
 *
 * Runs at the end of every scrape. An event without coordinates is not
 * on the map, so a venue the extractor met for the first time is
 * invisible until this runs — which, in the previous pipeline, was never.
 */

export interface GeocodeRunResult {
  attempted: number;
  resolved: number;
  eventUpdated: number;
}

/**
 * Venues never attempted, ordered by how many upcoming events depend on
 * them, so a capped run buys the most visibility.
 */
async function listVenueNeedingGeocode(limit: number) {
  return db
    .select({
      venueId: venue.venueId,
      name: venue.name,
      address: venue.address,
      pendingEvent: sql<number>`count(${event.eventId})`,
    })
    .from(venue)
    .leftJoin(
      event,
      and(eq(event.venueId, venue.venueId), sql`${event.eventDate} >= current_date`),
    )
    .where(and(isNull(venue.lat), isNull(venue.geocodeAttemptedAt)))
    .groupBy(venue.venueId)
    .orderBy(sql`count(${event.eventId}) desc`)
    .limit(limit);
}

/**
 * Copy a venue's coordinates onto its events.
 *
 * `location_status` is deliberately untouched. The previous script set
 * it to `confirmed` for every event it geocoded, which erased the
 * `tba` / `secret` / `dm_for_details` states — knowing where a venue is
 * does not mean the organiser has announced it.
 */
async function propagateToEvent(venueId: number, lat: number, lng: number): Promise<number> {
  const updated = await db
    .update(event)
    .set({ venueLat: lat, venueLng: lng, updatedAt: new Date() })
    .where(and(eq(event.venueId, venueId), isNull(event.venueLat)))
    .returning({ eventId: event.eventId });
  return updated.length;
}

/**
 * Geocode up to `limit` venues.
 *
 * Capped because Nominatim allows one request per second and a scrape
 * should not stall behind a long queue; the rest are picked up next run,
 * highest-impact first.
 */
export async function runGeocode(limit = 15): Promise<GeocodeRunResult> {
  const pending = await listVenueNeedingGeocode(limit);
  const result: GeocodeRunResult = { attempted: 0, resolved: 0, eventUpdated: 0 };

  if (pending.length === 0) return result;

  console.log(`\ngeocoding ${pending.length} venue(s)`);

  for (const row of pending) {
    result.attempted++;
    const outcome = await geocodeVenue(row.name, row.address);

    // Stamped either way, so a name that cannot be resolved stops being
    // retried at 1.1 seconds a go on every subsequent run.
    await recordGeocode(row.venueId, outcome.coordinate);

    if (!outcome.coordinate) {
      console.log(`  ✗ ${row.name}: ${outcome.reason}`);
      continue;
    }

    result.resolved++;
    const updated = await propagateToEvent(row.venueId, outcome.coordinate.lat, outcome.coordinate.lng);
    result.eventUpdated += updated;
    console.log(
      `  ✓ ${row.name} → ${outcome.coordinate.lat.toFixed(4)},${outcome.coordinate.lng.toFixed(4)}` +
      (updated > 0 ? ` (${updated} event)` : ''),
    );
  }

  return result;
}
