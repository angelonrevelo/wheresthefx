/**
 * Events Route — Core event discovery API
 *
 * HTTP only: parse and validate input, delegate to `src/db/event.ts`,
 * shape the response. No SQL lives here.
 *
 * ## Filtering
 * category, date range, free-only, venue, and full-text search.
 *
 * ## Pagination
 * page/limit, default 20, max 100.
 *
 * ## Saved Events
 * When authenticated, each event carries `isSaved`.
 */

import { Router, Request, Response } from 'express';
import { manilaToday, normalizeCategory, type Category } from '@wheresthefx/core';
import { optionalAuth } from '../middleware/auth.js';
import {
  findEventById,
  listEvent,
  listMapEvent,
  listUpcomingEvent,
  loadSavedIdFor,
  type EventStatus,
} from '../db/event.js';
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

/** The map endpoint was previously unbounded — the hottest query in the product. */
const MAP_LIMIT = 2000;

const router = Router();

/**
 * Reject a malformed date rather than silently dropping the filter.
 * Quietly ignoring a filter the caller asked for returns wrong data that
 * looks right, which is worse than an error.
 */
function rejectBadDate(req: Request, res: Response): boolean {
  for (const key of ['date_from', 'date_to'] as const) {
    if (req.query[key] !== undefined && parseIsoDate(req.query[key]) === undefined) {
      res.status(400).json({ error: `Invalid ${key}, expected YYYY-MM-DD` });
      return true;
    }
  }
  return false;
}

/**
 * GET /api/events
 *
 * Query params: category, date_from, date_to, is_free, search, venue_id,
 * status, page, limit.
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
    if (rejectBadDate(req, res)) return;

    const page = parseBoundedInt(req.query.page, { min: 1, max: 10_000, fallback: 1 });
    const limit = parseBoundedInt(req.query.limit, { min: 1, max: 100, fallback: 20 });

    const { rowList, total } = await listEvent({
      status: statusParam as EventStatus,
      category: categoryParam ? normalizeCategory(categoryParam)! : undefined,
      dateFrom: parseIsoDate(req.query.date_from),
      dateTo: parseIsoDate(req.query.date_to),
      isFree: parseBool(req.query.is_free),
      venueId,
      // Escaped: `?search=%` otherwise matches every row and forces a
      // full scan on an unauthenticated endpoint.
      search: searchParam ? escapeLikeTerm(searchParam) : undefined,
      page,
      limit,
    });

    const savedId = await loadSavedIdFor(req.user?.userId, rowList.map(row => row.eventId));

    res.json({
      data: rowList.map(row => ({ ...row, isSaved: savedId.has(row.eventId) })),
      pagination: {
        page,
        limit,
        total,
        totalPage: Math.ceil(total / limit),
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
 * Events from today (Manila) forward.
 */
router.get('/upcoming', optionalAuth, async (req: Request, res: Response) => {
  try {
    const limit = parseBoundedInt(req.query.limit, { min: 1, max: 100, fallback: 20 });
    const rowList = await listUpcomingEvent(manilaToday(), limit);
    const savedId = await loadSavedIdFor(req.user?.userId, rowList.map(row => row.eventId));

    res.json({
      data: rowList.map(row => ({ ...row, isSaved: savedId.has(row.eventId) })),
    });
  } catch (err) {
    console.error('Upcoming events error:', err);
    res.status(500).json({ error: 'Failed to fetch upcoming events' });
  }
});

/**
 * GET /api/events/map
 *
 * Geocoded upcoming events, trimmed to what a map pin needs.
 */
router.get('/map', async (req: Request, res: Response) => {
  try {
    const categoryParam = firstParam(req.query.category);

    if (categoryParam !== undefined && normalizeCategory(categoryParam) === null) {
      res.status(400).json({ error: `Unknown category: ${categoryParam}` });
      return;
    }
    if (rejectBadDate(req, res)) return;

    const data = await listMapEvent({
      today: manilaToday(),
      // `date_from` was destructured and never applied, so the map
      // silently ignored the user's start-date filter.
      dateFrom: parseIsoDate(req.query.date_from),
      dateTo: parseIsoDate(req.query.date_to),
      category: categoryParam ? (normalizeCategory(categoryParam) as Category) : undefined,
      limit: MAP_LIMIT,
    });

    res.json({ data });
  } catch (err) {
    console.error('Map events error:', err);
    res.status(500).json({ error: 'Failed to fetch map events' });
  }
});

/**
 * GET /api/events/:id
 */
router.get('/:id', optionalAuth, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === undefined) {
      res.status(400).json({ error: 'Invalid event ID' });
      return;
    }

    const found = await findEventById(id);
    if (!found) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    const savedId = await loadSavedIdFor(req.user?.userId, [found.eventId]);
    res.json({ ...found, isSaved: savedId.has(found.eventId) });
  } catch (err) {
    console.error('Event detail error:', err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

export default router;
