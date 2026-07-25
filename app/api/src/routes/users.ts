/**
 * Users Routes — Saved events and preferences
 *
 * All endpoints require authentication and are namespaced under `/me`,
 * meaning "the account this token belongs to".
 *
 * ## Endpoints
 * - GET  /api/users/me/saved       — List saved events
 * - POST /api/users/me/saved       — Save or unsave an event (toggle)
 * - GET  /api/users/me/preferences — Read category preferences
 * - PUT  /api/users/me/preferences — Update category preferences
 *
 * ## Why the paths changed
 *
 * The router served `/saved` and `/preferences` while the client called
 * `/me/saved` and `/me/preferences` — so every one of these 404'd in
 * production, and saving an event silently did nothing. The `/me` form
 * is what the client, `docs/api.md`, and `docs/README.md` all already
 * documented, so the server moved to match.
 *
 * ## Request casing
 *
 * Bodies are snake_case, matching the response contract. The previous
 * `POST /saved` demanded `{eventId}` while the client sent `{event_id}`
 * and the snakeCase middleware only ever transformed responses — so even
 * with the path corrected, the request would have failed validation.
 */

import { Router, Request, Response } from 'express';
import { db } from '@wheresthefx/db';
import { savedEvent, accountPreference } from '@wheresthefx/db';
import { eq, and, asc } from 'drizzle-orm';
import { normalizeCategory } from '@wheresthefx/core';
import { authenticate } from '../middleware/auth.js';
import { z } from 'zod';

const router = Router();

// All routes require authentication
router.use(authenticate);

const toggleSavedSchema = z.object({
  event_id: z.number().int().positive(),
});

const preferenceSchema = z.object({
  // Singular: this is a list of category values, one per entry.
  category: z.array(z.string()).max(12),
});

/** Narrow a zod failure to a single, client-usable message. */
function zodMessage(err: z.ZodError): string {
  const issue = err.issues[0];
  return issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request body';
}

/**
 * POST /api/users/me/saved
 *
 * Toggle save/unsave for an event.
 *
 * Request body: { event_id: number }
 * Response: { saved: boolean } — true if newly saved, false if unsaved
 */
router.post('/me/saved', async (req: Request, res: Response) => {
  try {
    const { event_id: eventId } = toggleSavedSchema.parse(req.body);
    const accountId = req.user!.userId;

    const existing = await db.query.savedEvent.findFirst({
      where: and(
        eq(savedEvent.accountId, accountId),
        eq(savedEvent.eventId, eventId),
      ),
    });

    if (existing) {
      await db.delete(savedEvent).where(
        and(
          eq(savedEvent.accountId, accountId),
          eq(savedEvent.eventId, eventId),
        )
      );
      res.json({ saved: false });
      return;
    }

    await db.insert(savedEvent).values({ accountId, eventId });
    res.json({ saved: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: zodMessage(err) });
      return;
    }
    // A FK violation means the event id does not exist — a client error,
    // not a server one.
    if (err instanceof Error && err.message.includes('foreign key')) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    console.error('Save event error:', err);
    res.status(500).json({ error: 'Failed to save event' });
  }
});

/**
 * GET /api/users/me/saved
 *
 * List all events saved by the current account, with venue data.
 */
router.get('/me/saved', async (req: Request, res: Response) => {
  try {
    const accountId = req.user!.userId;

    const saved = await db.query.savedEvent.findMany({
      where: eq(savedEvent.accountId, accountId),
      with: {
        event: {
          with: { venue: true },
        },
      },
      orderBy: [asc(savedEvent.savedAt)],
    });

    const data = saved.map(row => ({
      ...row.event,
      isSaved: true,
      savedAt: row.savedAt,
    }));

    res.json({ data });
  } catch (err) {
    console.error('Saved events error:', err);
    res.status(500).json({ error: 'Failed to fetch saved events' });
  }
});

/**
 * GET /api/users/me/preferences
 *
 * Read the account's preferred categories. This endpoint was documented
 * in `docs/api.md` but never implemented.
 *
 * Response: { category: string[] }
 */
router.get('/me/preferences', async (req: Request, res: Response) => {
  try {
    const accountId = req.user!.userId;

    const existing = await db.query.accountPreference.findFirst({
      where: eq(accountPreference.accountId, accountId),
    });

    res.json({ category: existing?.preferredCategories ?? [] });
  } catch (err) {
    console.error('Read preferences error:', err);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

/**
 * PUT /api/users/me/preferences
 *
 * Replace the account's preferred categories.
 *
 * Request body: { category: string[] }
 * Response: { category: string[] }
 */
router.put('/me/preferences', async (req: Request, res: Response) => {
  try {
    const { category } = preferenceSchema.parse(req.body);
    const accountId = req.user!.userId;

    // Validated against the canonical taxonomy so a typo cannot be
    // persisted and then silently match nothing forever.
    const normalized: string[] = [];
    for (const value of category) {
      const canonical = normalizeCategory(value);
      if (!canonical) {
        res.status(400).json({ error: `Unknown category: ${value}` });
        return;
      }
      if (!normalized.includes(canonical)) normalized.push(canonical);
    }

    const existing = await db.query.accountPreference.findFirst({
      where: eq(accountPreference.accountId, accountId),
    });

    if (existing) {
      await db.update(accountPreference)
        .set({ preferredCategories: normalized, updatedAt: new Date() })
        .where(eq(accountPreference.accountId, accountId));
    } else {
      await db.insert(accountPreference).values({
        accountId,
        preferredCategories: normalized,
      });
    }

    res.json({ category: normalized });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: zodMessage(err) });
      return;
    }
    console.error('Preferences error:', err);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

export default router;
