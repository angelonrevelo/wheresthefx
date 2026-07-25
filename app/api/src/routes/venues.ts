/**
 * Venues Routes — Venue directory API
 *
 * Provides endpoints for browsing the venue directory and
 * viewing events at specific venues.
 *
 * ## Endpoints
 * - GET /api/venues          — All venues with event counts
 * - GET /api/venues/:id      — Venue detail
 * - GET /api/venues/:id/events — Upcoming events at this venue
 */

import { Router, Request, Response } from 'express';
import { db } from '@wheresthefx/db';
import { venue, event } from '@wheresthefx/db';
import { eq, gte, asc, and, count } from 'drizzle-orm';
import { manilaToday } from '@wheresthefx/core';
import { parseId } from '../lib/param.js';

const router = Router();

/**
 * GET /api/venues
 *
 * List all venues with a count of upcoming events at each.
 * Venues are sorted alphabetically by name.
 * Optionally filter with ?search= to search venue names.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const today = manilaToday();

    const results = await db
      .select({
        id: venue.id,
        name: venue.name,
        address: venue.address,
        category: venue.category,
        lat: venue.lat,
        lng: venue.lng,
        eventCount: count(event.id),
      })
      .from(venue)
      .leftJoin(
        event,
        and(
          eq(event.venueId, venue.id),
          gte(event.eventDate, today),
          eq(event.eventStatus, 'confirmed'),
        )
      )
      .groupBy(venue.id)
      .orderBy(asc(venue.name));

    res.json({ data: results });
  } catch (err) {
    console.error('Venues list error:', err);
    res.status(500).json({ error: 'Failed to fetch venues' });
  }
});

/**
 * GET /api/venues/:id
 *
 * Get a single venue by ID with full details.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === undefined) {
      res.status(400).json({ error: 'Invalid venue ID' });
      return;
    }

    const result = await db.query.venue.findFirst({
      where: eq(venue.id, id),
    });

    if (!result) {
      res.status(404).json({ error: 'Venue not found' });
      return;
    }

    res.json(result);
  } catch (err) {
    console.error('Venue detail error:', err);
    res.status(500).json({ error: 'Failed to fetch venue' });
  }
});

/**
 * GET /api/venues/:id/events
 *
 * Get upcoming events at a specific venue.
 * Only returns confirmed events from today forward.
 */
router.get('/:id/events', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === undefined) {
      res.status(400).json({ error: 'Invalid venue ID' });
      return;
    }

    const today = manilaToday();

    const results = await db.query.event.findMany({
      where: and(
        eq(event.venueId, id),
        gte(event.eventDate, today),
        eq(event.eventStatus, 'confirmed'),
      ),
      orderBy: [asc(event.eventDate), asc(event.eventTime)],
    });

    res.json({ data: results });
  } catch (err) {
    console.error('Venue events error:', err);
    res.status(500).json({ error: 'Failed to fetch venue events' });
  }
});

export default router;
