/**
 * Categories Routes — Event category metadata
 *
 * Returns the canonical category list with upcoming-event counts and
 * display labels. Used by the frontend to render category filter chips.
 *
 * The taxonomy itself lives in `@wheresthefx/core` — this route renders
 * it, it does not define it. The previous local copy had drifted: its
 * docblock still described the retired 9-category set (`art_culture`,
 * `other`) while the map below it listed a different 12.
 */

import { Router, Request, Response } from 'express';
import { db, event } from '@wheresthefx/db';
import { CATEGORY, CATEGORY_META, type Category } from '@wheresthefx/core';
import { manilaToday } from '@wheresthefx/core';
import { eq, gte, and, count } from 'drizzle-orm';

const router = Router();

/**
 * GET /api/categories
 *
 * Returns all categories with their upcoming event counts
 * and display metadata (label, emoji).
 *
 * Response: { data: [{ value, label, emoji, count }] }
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const today = manilaToday();

    // Count upcoming confirmed events per category
    const countRow = await db
      .select({
        category: event.category,
        count: count(),
      })
      .from(event)
      .where(and(
        gte(event.eventDate, today),
        eq(event.eventStatus, 'confirmed'),
      ))
      .groupBy(event.category);

    const countMap = new Map(countRow.map(row => [row.category, Number(row.count)]));

    // Every canonical category is returned, including zero-count ones, so
    // the filter chips stay stable rather than appearing and disappearing.
    const data = CATEGORY.map((value: Category) => ({
      value,
      label: CATEGORY_META[value].label,
      emoji: CATEGORY_META[value].emoji,
      count: countMap.get(value) ?? 0,
    }));

    // Most populated first.
    data.sort((a, b) => b.count - a.count);

    res.json({ data });
  } catch (err) {
    console.error('Categories error:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

export default router;
