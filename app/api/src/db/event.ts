import { db } from '@wheresthefx/db';
import { event, savedEvent, sourcePost } from '@wheresthefx/db';
import {
  and, asc, count, eq, gte, ilike, inArray, lte, or, sql, type SQL,
} from 'drizzle-orm';
import type { Category } from '@wheresthefx/core';

/**
 * Event data access.
 *
 * Routes are HTTP only: they parse, validate, and shape responses. Every
 * query lives here. Before this layer existed the `ORDER BY` was written
 * out at five separate call sites, which meant introducing promoted
 * events would have required finding and editing all five — and missing
 * one would have shipped a ranking bug nobody could see.
 */

export type EventStatus = 'confirmed' | 'rescheduled' | 'cancelled' | 'postponed' | 'tentative';

export interface EventListFilter {
  status: EventStatus;
  category?: Category;
  dateFrom?: string;
  dateTo?: string;
  isFree?: boolean;
  venueId?: number;
  search?: string;
  page: number;
  limit: number;
}

/**
 * Canonical ordering for every user-facing event list.
 *
 * Promotion slots in ahead of chronology here, once and only once. It is
 * a no-op until `promotion_rank` is populated (M5).
 */
function eventOrdering() {
  return [asc(event.eventDate), asc(event.eventTime)];
}

function buildListCondition(filter: EventListFilter): SQL[] {
  const condition: SQL[] = [eq(event.eventStatus, filter.status)];

  if (filter.category) condition.push(eq(event.category, filter.category));
  if (filter.dateFrom) condition.push(gte(event.eventDate, filter.dateFrom));
  if (filter.dateTo) condition.push(lte(event.eventDate, filter.dateTo));
  if (filter.isFree !== undefined) condition.push(eq(event.isFree, filter.isFree));
  if (filter.venueId !== undefined) condition.push(eq(event.venueId, filter.venueId));

  if (filter.search) {
    const term = `%${filter.search}%`;
    const searchCondition = or(
      ilike(event.title, term),
      ilike(event.description, term),
      ilike(event.venueName, term),
    );
    if (searchCondition) condition.push(searchCondition);
  }

  return condition;
}

/** One page of events, plus the total for pagination. */
export async function listEvent(filter: EventListFilter) {
  const condition = buildListCondition(filter);
  const where = condition.length > 0 ? and(...condition) : undefined;
  const offset = (filter.page - 1) * filter.limit;

  // Issued together — these were sequential awaits, doubling latency on
  // the most-requested endpoint for no reason.
  const [totalRow, rowList] = await Promise.all([
    db.select({ total: count() }).from(event).where(where),
    db.query.event.findMany({
      where,
      with: {
        venue: true,
        sourceAccount: { columns: { username: true, fullName: true } },
        sourcePost: { columns: { shortcode: true, postUrl: true } },
        subEvent: true,
      },
      orderBy: eventOrdering(),
      limit: filter.limit,
      offset,
    }),
  ]);

  return { rowList, total: Number(totalRow[0]?.total ?? 0) };
}

/** Upcoming confirmed events from `today` forward. */
export async function listUpcomingEvent(today: string, limit: number) {
  return db.query.event.findMany({
    where: and(gte(event.eventDate, today), eq(event.eventStatus, 'confirmed')),
    with: { venue: true, subEvent: true },
    orderBy: eventOrdering(),
    limit,
  });
}

export interface MapFilter {
  today: string;
  dateFrom?: string;
  dateTo?: string;
  category?: Category;
  limit: number;
}

/** Geocoded upcoming events, trimmed to what a map pin needs. */
export async function listMapEvent(filter: MapFilter) {
  const condition: SQL[] = [
    sql`${event.venueLat} IS NOT NULL`,
    eq(event.eventStatus, 'confirmed'),
    gte(
      event.eventDate,
      filter.dateFrom && filter.dateFrom > filter.today ? filter.dateFrom : filter.today,
    ),
  ];

  if (filter.category) condition.push(eq(event.category, filter.category));
  if (filter.dateTo) condition.push(lte(event.eventDate, filter.dateTo));

  return db
    .select({
      id: event.eventId,
      title: event.title,
      eventDate: event.eventDate,
      eventEndDate: event.eventEndDate,
      eventTime: event.eventTime,
      endTime: event.endTime,
      venueName: event.venueName,
      venueAddress: event.venueAddress,
      venueLat: event.venueLat,
      venueLng: event.venueLng,
      category: event.category,
      isFree: event.isFree,
      price: event.price,
      imageUrl: event.imageUrl,
      sourceUsername: event.sourceUsername,
      priceNote: event.priceNote,
      locationStatus: event.locationStatus,
      eventStatus: event.eventStatus,
      availabilityStatus: event.availabilityStatus,
      isRecurring: event.isRecurring,
      recurrencePattern: event.recurrencePattern,
      description: event.description,
      sourcePostShortcode: sourcePost.shortcode,
      sourcePostUrl: sourcePost.postUrl,
    })
    .from(event)
    .leftJoin(sourcePost, eq(event.sourcePostId, sourcePost.sourcePostId))
    .where(and(...condition))
    .orderBy(...eventOrdering())
    // The map endpoint had no limit at all — the hottest and least
    // bounded query in the product.
    .limit(filter.limit);
}

/** One event with its relations, or undefined. */
export async function findEventById(eventId: number) {
  return db.query.event.findFirst({
    where: eq(event.eventId, eventId),
    with: {
      venue: true,
      sourceAccount: { columns: { username: true, fullName: true } },
      sourcePost: { columns: { shortcode: true, postUrl: true } },
      subEvent: true,
    },
  });
}

/**
 * Which of `eventIdList` the account has saved.
 *
 * Scoped to the page being rendered rather than selecting the account's
 * entire saved set on every list request.
 */
export async function loadSavedIdFor(
  accountId: number | undefined,
  eventIdList: number[],
): Promise<Set<number>> {
  if (accountId === undefined || eventIdList.length === 0) return new Set();

  const rowList = await db
    .select({ eventId: savedEvent.eventId })
    .from(savedEvent)
    .where(and(
      eq(savedEvent.accountId, accountId),
      inArray(savedEvent.eventId, eventIdList),
    ));

  return new Set(rowList.map(row => row.eventId));
}
