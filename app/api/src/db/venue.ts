import { db } from '@wheresthefx/db';
import { event, venue } from '@wheresthefx/db';
import { and, asc, count, eq, gte } from 'drizzle-orm';
import type { Category } from '@wheresthefx/core';

/** Venue and category data access. */

/** Venues with a count of their upcoming confirmed events. */
export async function listVenueWithEventCount(today: string) {
  return db
    .select({
      id: venue.venueId,
      name: venue.name,
      address: venue.address,
      lat: venue.lat,
      lng: venue.lng,
      category: venue.category,
      eventCount: count(event.eventId),
    })
    .from(venue)
    .leftJoin(
      event,
      and(
        eq(event.venueId, venue.venueId),
        eq(event.eventStatus, 'confirmed'),
        gte(event.eventDate, today),
      ),
    )
    .groupBy(venue.venueId)
    .orderBy(asc(venue.name));
}

export async function findVenueById(venueId: number) {
  return db.query.venue.findFirst({ where: eq(venue.venueId, venueId) });
}

/** Upcoming confirmed events at one venue. */
export async function listEventAtVenue(venueId: number, today: string, limit: number) {
  return db.query.event.findMany({
    where: and(
      eq(event.venueId, venueId),
      eq(event.eventStatus, 'confirmed'),
      gte(event.eventDate, today),
    ),
    orderBy: [asc(event.eventDate), asc(event.eventTime)],
    limit,
  });
}

/** Upcoming confirmed event counts, grouped by category. */
export async function countEventByCategory(today: string): Promise<Map<Category, number>> {
  const rowList = await db
    .select({ category: event.category, total: count() })
    .from(event)
    .where(and(gte(event.eventDate, today), eq(event.eventStatus, 'confirmed')))
    .groupBy(event.category);

  const countByCategory = new Map<Category, number>();
  for (const row of rowList) {
    if (row.category) countByCategory.set(row.category as Category, Number(row.total));
  }
  return countByCategory;
}
