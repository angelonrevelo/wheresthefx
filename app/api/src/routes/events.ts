/**
 * Events Routes — Core event discovery API
 *
 * The main API surface for WheresTheFX. Provides endpoints for
 * listing, filtering, searching, and viewing events.
 *
 * ## Filtering
 * Events can be filtered by:
 * - category (nightlife, music, art_culture, etc.)
 * - date range (date_from, date_to)
 * - free events (is_free=true)
 * - venue (venue_id)
 * - search text (searches title, description, venue)
 *
 * ## Pagination
 * All list endpoints support page/limit pagination.
 * Default: page=1, limit=20, max limit=100.
 *
 * ## Saved Events
 * When authenticated, events include an `isSaved` boolean
 * indicating whether the current user has saved the event.
 */

import { Router, Request, Response } from 'express';
import { db } from '@wheresthefx/db';
import { event, savedEvent, sourcePost } from '@wheresthefx/db';
import { eq, gte, lte, and, or, ilike, asc, sql, count, inArray, type SQL } from 'drizzle-orm';
import { manilaToday, normalizeCategory } from '@wheresthefx/core';
import { optionalAuth } from '../middleware/auth.js';
import {
  escapeLikeTerm,
  firstParam,
  parseBool,
  parseBoundedInt,
  parseId,
  parseIsoDate,
} from '../lib/param.js';

/** Mirrors `eventStatusEnum` in the schema. */
const EVENT_STATUS = ['confirmed', 'rescheduled', 'cancelled', 'postponed', 'tentative'] as const;
type EventStatus = (typeof EVENT_STATUS)[number];


/**
 * Which of `eventIdList` the account has saved.
 *
 * Scoped to the page being rendered. The previous version selected the
 * account's entire saved set on every list request just to compute a
 * boolean for at most 100 rows — unbounded as a user's saves grow.
 */
async function loadSavedIdFor(
  accountId: number | undefined,
  eventIdList: number[],
): Promise<Set<number>> {
  if (accountId === undefined || eventIdList.length === 0) return new Set();

  const row = await db
    .select({ eventId: savedEvent.eventId })
    .from(savedEvent)
    .where(and(
      eq(savedEvent.accountId, accountId),
      inArray(savedEvent.eventId, eventIdList),
    ));

  return new Set(row.map(entry => entry.eventId));
}

const router = Router();

/**
 * GET /api/events
 *
 * List events with filtering, search, and pagination.
 *
 * Query params:
 * - category: string (event category)
 * - date_from: string (YYYY-MM-DD)
 * - date_to: string (YYYY-MM-DD)
 * - is_free: "true" | "false"
 * - search: string (searches title, description, venue_name)
 * - venue_id: number
 * - status: string (default: "confirmed")
 * - page: number (default: 1)
 * - limit: number (default: 20, max: 100)
 */
router.get('/', optionalAuth, async (req: Request, res: Response) => {
  try {
    // Every one of these was previously read raw off `req.query` and cast
    // with `as any` straight into the query builder, so `?status=lol`,
    // `?category=Music`, `?venue_id=abc` and `?date_from=notadate` each
    // produced a Postgres type error surfaced to the caller as a 500.
    const categoryParam = firstParam(req.query.category);
    const statusParam = firstParam(req.query.status) ?? 'confirmed';
    const searchParam = firstParam(req.query.search);
    const dateFrom = parseIsoDate(req.query.date_from);
    const dateTo = parseIsoDate(req.query.date_to);
    const isFree = parseBool(req.query.is_free);
    const venueId = parseId(req.query.venue_id);

    if (!EVENT_STATUS.includes(statusParam as EventStatus)) {
      res.status(400).json({ error: `Unknown status: ${statusParam}` });
      return;
    }
    if (categoryParam !== undefined && normalizeCategory(categoryParam) === null) {
      res.status(400).json({ error: `Unknown category: ${categoryParam}` });
      return;
    }
    if (req.query.venue_id !== undefined && venueId === undefined) {
      res.status(400).json({ error: 'Invalid venue_id' });
      return;
    }

    // A malformed date is rejected rather than silently dropped: quietly
    // ignoring a filter the caller asked for returns wrong data that looks
    // right, which is worse than an error.
    for (const key of ['date_from', 'date_to'] as const) {
      if (req.query[key] !== undefined && parseIsoDate(req.query[key]) === undefined) {
        res.status(400).json({ error: `Invalid ${key}, expected YYYY-MM-DD` });
        return;
      }
    }


    const pageNum = parseBoundedInt(req.query.page, { min: 1, max: 10_000, fallback: 1 });
    const limitNum = parseBoundedInt(req.query.limit, { min: 1, max: 100, fallback: 20 });
    const offset = (pageNum - 1) * limitNum;

    const condition: SQL[] = [eq(event.eventStatus, statusParam as EventStatus)];

    if (categoryParam) {
      condition.push(eq(event.category, normalizeCategory(categoryParam)!));
    }
    if (dateFrom) {
      condition.push(gte(event.eventDate, dateFrom));
    }
    if (dateTo) {
      condition.push(lte(event.eventDate, dateTo));
    }
    if (isFree !== undefined) {
      condition.push(eq(event.isFree, isFree));
    }
    if (venueId !== undefined) {
      condition.push(eq(event.venueId, venueId));
    }
    if (searchParam) {
      // Escaped: `?search=%` otherwise matches every row and forces a
      // full scan on an unauthenticated endpoint.
      const term = `%${escapeLikeTerm(searchParam)}%`;
      const searchCondition = or(
        ilike(event.title, term),
        ilike(event.description, term),
        ilike(event.venueName, term),
      );
      if (searchCondition) condition.push(searchCondition);
    }

    const where = condition.length > 0 ? and(...condition) : undefined;

    // Get total count
    const [{ total }] = await db
      .select({ total: count() })
      .from(event)
      .where(where);

    // Get events
    const results = await db.query.event.findMany({
      where,
      with: {
        venue: true,
        sourceAccount: {
          columns: { username: true, fullName: true },
        },
        sourcePost: {
          columns: { shortcode: true, postUrl: true },
        },
        subEvent: true,
      },
      orderBy: [asc(event.eventDate), asc(event.eventTime)],
      limit: limitNum,
      offset,
    });

    const savedId = await loadSavedIdFor(req.user?.userId, results.map(row => row.id));

    const data = results.map(row => ({
      ...row,
      isSaved: savedId.has(row.id),
    }));

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limitNum),
      },
    });
  } catch (err) {
    console.error('Events list error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

/**
 * GET /api/events/upcoming
 *
 * Events from today forward, ordered by date.
 * Shortcut for GET /api/events?date_from=today&status=confirmed
 */
router.get('/upcoming', optionalAuth, async (req: Request, res: Response) => {
  try {
    const today = manilaToday();
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);

    const results = await db.query.event.findMany({
      where: and(
        gte(event.eventDate, today),
        eq(event.eventStatus, 'confirmed'),
      ),
      with: {
        venue: true,
        subEvent: true,
      },
      orderBy: [asc(event.eventDate), asc(event.eventTime)],
      limit,
    });

    const savedId = await loadSavedIdFor(req.user?.userId, results.map(row => row.id));

    res.json({
      data: results.map(row => ({
        ...row,
        isSaved: savedId.has(row.id),
      })),
    });
  } catch (err) {
    console.error('Upcoming events error:', err);
    res.status(500).json({ error: 'Failed to fetch upcoming events' });
  }
});

/**
 * GET /api/events/map
 *
 * Events with lat/lng for map markers. Returns a lightweight payload
 * optimized for rendering map pins (no descriptions, no sub-events).
 * Only includes events that have geocoding data.
 */
router.get('/map', async (req: Request, res: Response) => {
  try {
    const today = manilaToday();
    const categoryParam = firstParam(req.query.category);
    const dateFrom = parseIsoDate(req.query.date_from);
    const dateTo = parseIsoDate(req.query.date_to);

    if (categoryParam !== undefined && normalizeCategory(categoryParam) === null) {
      res.status(400).json({ error: `Unknown category: ${categoryParam}` });
      return;
    }

    // A malformed date is rejected rather than silently dropped: quietly
    // ignoring a filter the caller asked for returns wrong data that looks
    // right, which is worse than an error.
    for (const key of ['date_from', 'date_to'] as const) {
      if (req.query[key] !== undefined && parseIsoDate(req.query[key]) === undefined) {
        res.status(400).json({ error: `Invalid ${key}, expected YYYY-MM-DD` });
        return;
      }
    }

    const condition: SQL[] = [
      sql`${event.venueLat} IS NOT NULL`,
      eq(event.eventStatus, 'confirmed'),
    ];

    // `date_from` was destructured here but never applied, so the map
    // silently ignored the user's start-date filter. It is honoured now,
    // clamped so a past date cannot widen the window behind "today".
    condition.push(gte(event.eventDate, dateFrom && dateFrom > today ? dateFrom : today));

    if (categoryParam) {
      condition.push(eq(event.category, normalizeCategory(categoryParam)!));
    }
    if (dateTo) {
      condition.push(lte(event.eventDate, dateTo));
    }

    const results = await db
      .select({
        id: event.id,
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
        priceNotes: event.priceNotes,
        signupUrl: event.signupUrl,
        eventStatus: event.eventStatus,
        availabilityStatus: event.availabilityStatus,
        isRecurring: event.isRecurring,
        recurrencePattern: event.recurrencePattern,
        priceMin: event.priceMin,
        priceMax: event.priceMax,
        sourcePostShortcode: sourcePost.shortcode,
        sourcePostUrl: sourcePost.postUrl,
      })
      .from(event)
      .leftJoin(sourcePost, eq(event.sourcePostId, sourcePost.id))
      .where(and(...condition))
      .orderBy(asc(event.eventDate));

    res.json({ data: results });
  } catch (err) {
    console.error('Map events error:', err);
    res.status(500).json({ error: 'Failed to fetch map events' });
  }
});

/**
 * GET /api/events/:id
 *
 * Single event with full details including sub-events, venue, and source info.
 */
router.get('/:id', optionalAuth, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === undefined) {
      res.status(400).json({ error: 'Invalid event ID' });
      return;
    }

    const result = await db.query.event.findFirst({
      where: eq(event.id, id),
      with: {
        venue: true,
        sourcePost: true,
        sourceAccount: {
          columns: { username: true, fullName: true },
        },
        subEvent: true,
      },
    });

    if (!result) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    // Check if saved by current user
    let isSaved = false;
    if (req.user) {
      const saved = await db.query.savedEvent.findFirst({
        where: and(
          eq(savedEvent.accountId, req.user.userId),
          eq(savedEvent.eventId, id),
        ),
      });
      isSaved = !!saved;
    }

    res.json({ ...result, isSaved });
  } catch (err) {
    console.error('Event detail error:', err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

export default router;
