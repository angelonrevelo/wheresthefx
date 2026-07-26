/**
 * Venues Route — Venue directory API
 *
 * HTTP only; queries live in `src/db/venue.ts`.
 *
 * ## Endpoints
 * - GET /api/venues            — All venues with upcoming event counts
 * - GET /api/venues/:id        — Venue detail
 * - GET /api/venues/:id/events — Upcoming events at this venue
 */

import { Router, Request, Response } from 'express';
import { manilaToday } from '@wheresthefx/core';
import { findVenueById, listEventAtVenue, listVenueWithEventCount } from '../db/venue.js';
import { withId, withIdList } from '../lib/dto.js';
import { parseBoundedInt, parseId } from '../lib/param.js';

const router = Router();

/** Upper bound on a venue's event list; it was previously unpaginated. */
const VENUE_EVENT_LIMIT = 100;

/**
 * GET /api/venues
 *
 * Response: { data: [{ id, name, address, lat, lng, category, event_count }] }
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const data = await listVenueWithEventCount(manilaToday());
    res.json({ data });
  } catch (err) {
    console.error('Venues list error:', err);
    res.status(500).json({ error: 'Failed to fetch venues' });
  }
});

/**
 * GET /api/venues/:id
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === undefined) {
      res.status(400).json({ error: 'Invalid venue ID' });
      return;
    }

    const found = await findVenueById(id);
    if (!found) {
      res.status(404).json({ error: 'Venue not found' });
      return;
    }

    res.json(withId(found, 'venueId'));
  } catch (err) {
    console.error('Venue detail error:', err);
    res.status(500).json({ error: 'Failed to fetch venue' });
  }
});

/**
 * GET /api/venues/:id/events
 */
router.get('/:id/events', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === undefined) {
      res.status(400).json({ error: 'Invalid venue ID' });
      return;
    }

    const limit = parseBoundedInt(req.query.limit, {
      min: 1,
      max: VENUE_EVENT_LIMIT,
      fallback: VENUE_EVENT_LIMIT,
    });

    const rowList = await listEventAtVenue(id, manilaToday(), limit);
    res.json({ data: withIdList(rowList, 'eventId') });
  } catch (err) {
    console.error('Venue events error:', err);
    res.status(500).json({ error: 'Failed to fetch venue events' });
  }
});

export default router;
