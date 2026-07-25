/**
 * Users Routes — Saved events and preferences
 *
 * Endpoints for authenticated accounts to manage their saved events
 * and category preferences. All endpoints require authentication.
 *
 * ## Endpoints
 * - POST /api/users/me/saved       — Save or unsave an event (toggle)
 * - GET  /api/users/me/saved       — List all saved events
 * - PUT  /api/users/me/preferences — Update category preferences
 */

import { Router, Request, Response } from 'express';
import { db } from '@wheresthefx/db';
import { savedEvent, accountPreference } from '@wheresthefx/db';
import { eq, and, asc } from 'drizzle-orm';
import { authenticate } from '../middleware/auth.js';
import { z } from 'zod';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/users/me/saved
 *
 * Toggle save/unsave for an event. If the event is already saved,
 * it will be unsaved (deleted). If not saved, it will be saved.
 *
 * Request body: { eventId: number }
 * Response: { saved: boolean } — true if newly saved, false if unsaved
 */
router.post('/saved', async (req: Request, res: Response) => {
  try {
    const { eventId } = z.object({ eventId: z.number() }).parse(req.body);
    const accountId = req.user!.userId;

    // Check if already saved
    const existing = await db.query.savedEvent.findFirst({
      where: and(
        eq(savedEvent.accountId, accountId),
        eq(savedEvent.eventId, eventId),
      ),
    });

    if (existing) {
      // Unsave
      await db.delete(savedEvent).where(
        and(
          eq(savedEvent.accountId, accountId),
          eq(savedEvent.eventId, eventId),
        )
      );
      res.json({ saved: false });
    } else {
      // Save
      await db.insert(savedEvent).values({ accountId, eventId });
      res.json({ saved: true });
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error('Save event error:', err);
    res.status(500).json({ error: 'Failed to save event' });
  }
});

/**
 * GET /api/users/me/saved
 *
 * List all events saved by the current account.
 * Returns full event objects with venue data.
 */
router.get('/saved', async (req: Request, res: Response) => {
  try {
    const accountId = req.user!.userId;

    const saved = await db.query.savedEvent.findMany({
      where: eq(savedEvent.accountId, accountId),
      with: {
        event: {
          with: {
            venue: true,
          },
        },
      },
      orderBy: [asc(savedEvent.savedAt)],
    });

    const data = saved.map(s => ({
      ...s.event,
      isSaved: true,
      savedAt: s.savedAt,
    }));

    res.json({ data });
  } catch (err) {
    console.error('Saved events error:', err);
    res.status(500).json({ error: 'Failed to fetch saved events' });
  }
});

/**
 * PUT /api/users/me/preferences
 *
 * Update the account's preferred event categories.
 * Used for future "For You" personalized feed.
 *
 * Request body: { categories: string[] }
 * Response: { categories: string[] }
 */
router.put('/preferences', async (req: Request, res: Response) => {
  try {
    const { categories } = z.object({
      categories: z.array(z.string()),
    }).parse(req.body);

    const accountId = req.user!.userId;

    // Upsert preferences
    const existing = await db.query.accountPreference.findFirst({
      where: eq(accountPreference.accountId, accountId),
    });

    if (existing) {
      await db.update(accountPreference)
        .set({ preferredCategories: categories, updatedAt: new Date() })
        .where(eq(accountPreference.accountId, accountId));
    } else {
      await db.insert(accountPreference).values({
        accountId,
        preferredCategories: categories,
      });
    }

    res.json({ categories });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error('Preferences error:', err);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

export default router;
