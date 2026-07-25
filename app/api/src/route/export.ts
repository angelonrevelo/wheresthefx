/**
 * Export Routes — the tripi feed
 *
 * ## Endpoints
 * - GET /api/export/place-draft — the venue catalog, as tripi place drafts
 * - GET /api/export/event-draft — upcoming dated events, as tripi event drafts
 *
 * HTTP only. The SQL is in `src/db/tripiExport.ts` and the mapping is in `@wheresthefx/core`,
 * so this file parses query params, calls down, and serialises. See docs/TRIPI.md for the
 * contract and for what tripi has to change to consume it.
 *
 * ## Why this is a pull feed and not a push
 *
 * tripi already has a bulk ingest command per source (`npm run ingest:place -- osm|fsq|overture`)
 * that reads a feed, records the raw payload in `place_ingest`, and upserts into `place`. A pull
 * endpoint drops straight into that shape: it needs no credentials on this side, no delivery
 * retry, and no knowledge of tripi's schedule. Pushing would mean this repo owning a queue to
 * solve a problem tripi's ingest already solves.
 *
 * ## Response casing
 *
 * The drafts are already snake_case, because they mirror tripi's columns exactly. They pass
 * through `snakeCaseResponse` unchanged -- its camelCase-to-snake_case walk is a no-op on keys
 * that are already snake_case. That is worth stating because it means a rename in
 * `package/core` reaches the wire directly, with no middleware to keep in step.
 */

import { Router, Request, Response } from 'express';
import { toDraftExport, toEventDraft, toPlaceDraft } from '@wheresthefx/core';
import { findEventForExport, findVenueForExport } from '../db/tripiExport.js';
import { firstParam, parseIsoDate } from '../lib/param.js';

const router = Router();

/**
 * GET /api/export/place-draft
 *
 * The whole venue directory as tripi place drafts. Unpaginated on purpose: the catalog is in
 * the low thousands, tripi's ingest wants one convergent pass rather than a cursor to resume,
 * and a partial catalog would let its `(name, area)` dedupe mint rows it later has to merge.
 */
router.get('/place-draft', async (_req: Request, res: Response) => {
  try {
    const row = await findVenueForExport();
    res.json(toDraftExport(row.map((one) => toPlaceDraft(one)), new Date()));
  } catch (err) {
    console.error('Place draft export error:', err);
    res.status(500).json({ error: 'Failed to export place drafts' });
  }
});

/**
 * GET /api/export/event-draft?since=YYYY-MM-DD
 *
 * Upcoming confirmed events as tripi event drafts. `since` is a floor on the event date, so a
 * consumer polling daily can ask only for what it has not seen without this side tracking
 * per-consumer state.
 */
router.get('/event-draft', async (req: Request, res: Response) => {
  try {
    const sinceRaw = firstParam(req.query.since);
    const since = parseIsoDate(req.query.since);

    // Rejected rather than ignored: silently dropping a filter the caller asked for returns a
    // wider window that looks like a correct answer.
    if (sinceRaw !== undefined && since === undefined) {
      res.status(400).json({ error: 'Invalid since, expected YYYY-MM-DD' });
      return;
    }

    const row = await findEventForExport(since);
    res.json(toDraftExport(row.map((one) => toEventDraft(one)), new Date()));
  } catch (err) {
    console.error('Event draft export error:', err);
    res.status(500).json({ error: 'Failed to export event drafts' });
  }
});

export default router;
