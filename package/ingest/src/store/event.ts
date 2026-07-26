import { db, event, subEvent } from '@wheresthefx/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Category } from '@wheresthefx/core';
import {
  completenessScore,
  eventHash,
  titleSimilarity,
  type ReviewTier,
} from '../identity/hash.js';

/**
 * Event persistence.
 *
 * The two rules that matter here, both of which the previous ingest got
 * wrong:
 *
 * 1. **Better data wins.** On a hash collision the row with the higher
 *    completeness score is kept. The old ingest did an unconditional
 *    `set: values`, so whichever row happened to be processed last won —
 *    meaning a low-confidence re-scrape routinely overwrote a good
 *    record, despite the docstring claiming otherwise.
 *
 * 2. **One transaction per event.** An event and its sub-events are
 *    written together or not at all. Sub-events were previously deleted
 *    and re-inserted as separate autocommit statements, so the API
 *    served events with zero sub-events for the duration, and a crash in
 *    between lost them until the next run.
 */

export interface EventDraft {
  title: string;
  eventDate: string;
  eventEndDate?: string | null;
  eventTime?: string | null;
  endTime?: string | null;
  description?: string | null;
  venueId?: number | null;
  venueName?: string | null;
  venueAddress?: string | null;
  venueLat?: number | null;
  venueLng?: number | null;
  locationStatus?: 'confirmed' | 'tba' | 'secret' | 'dm_for_details';
  isFree?: boolean | null;
  price?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  priceNote?: string | null;
  signupUrl?: string | null;
  category?: Category | null;
  artist?: string[] | null;
  eventStatus?: 'confirmed' | 'rescheduled' | 'cancelled' | 'postponed' | 'tentative';
  availabilityStatus?: 'available' | 'sold_out' | 'waitlist' | 'limited' | 'early_bird' | null;
  isRecurring?: boolean;
  recurrencePattern?: string | null;
  confidence?: number | null;
  reviewTier?: ReviewTier;
  imageUrl?: string | null;
  sourceUsername?: string | null;
  sourcePostId?: number | null;
  sourceAccountId?: number | null;
  subEventList?: {
    title: string;
    eventDate?: string | null;
    eventTime?: string | null;
    endTime?: string | null;
    description?: string | null;
  }[] | null;
}

export type SaveOutcome = 'inserted' | 'updated' | 'kept_existing' | 'merged';

/**
 * How similar two titles must be, on the same date at the same venue,
 * to count as the same event.
 *
 * High on purpose. A wrong merge deletes an event from the product and
 * nobody notices; a missed merge shows two cards and someone might. The
 * case this exists for is "PORKLABANAN: National Hog Festival 2026" vs
 * "Porklabanan: National Hog Fest" — the same event posted twice, which
 * the content hash cannot catch because "festival" and "fest" normalise
 * differently.
 */
const FUZZY_MERGE_THRESHOLD = 0.75;

/**
 * Higher bar for merging when one side has no venue.
 *
 * A live run produced "Electric All In Challenge" with a venue and
 * "ELECTRIC ALL IN CHALLENGE" without one, on the same date from the same
 * account — one event, two rows, because the hash includes the venue.
 * Without a shared venue to confirm the match, the titles have to be
 * near-identical before they are treated as the same thing.
 */
const VENUELESS_MERGE_THRESHOLD = 0.9;

/**
 * Insert or update one event, keyed on its content hash.
 *
 * Returns which of the three things happened, so a run can report how
 * much of its work was genuinely new rather than just claiming a count.
 */
export async function saveEvent(draft: EventDraft): Promise<SaveOutcome> {
  const hash = eventHash(draft.title, draft.eventDate, draft.venueName);
  const score = completenessScore({
    title: draft.title,
    eventDate: draft.eventDate,
    eventTime: draft.eventTime,
    venueName: draft.venueName,
    price: draft.price,
    isFree: draft.isFree,
    signupUrl: draft.signupUrl,
    imageUrl: draft.imageUrl,
    description: draft.description,
    category: draft.category,
    artist: draft.artist,
  });

  return db.transaction(async (tx) => {
    const existing = await tx.query.event.findFirst({
      where: eq(event.eventHash, hash),
      columns: { eventId: true, completenessScore: true },
    });

    const value = {
      title: draft.title,
      eventDate: draft.eventDate,
      eventEndDate: draft.eventEndDate ?? null,
      eventTime: draft.eventTime ?? null,
      endTime: draft.endTime ?? null,
      description: draft.description ?? null,
      venueId: draft.venueId ?? null,
      venueName: draft.venueName ?? null,
      venueAddress: draft.venueAddress ?? null,
      venueLat: draft.venueLat ?? null,
      venueLng: draft.venueLng ?? null,
      locationStatus: draft.locationStatus ?? 'confirmed',
      isFree: draft.isFree ?? null,
      price: draft.price ?? null,
      priceMin: draft.priceMin ?? null,
      priceMax: draft.priceMax ?? null,
      priceNote: draft.priceNote ?? null,
      signupUrl: draft.signupUrl ?? null,
      category: draft.category ?? null,
      artist: draft.artist ?? null,
      eventStatus: draft.eventStatus ?? 'confirmed',
      availabilityStatus: draft.availabilityStatus ?? 'available',
      isRecurring: draft.isRecurring ?? false,
      recurrencePattern: draft.recurrencePattern ?? null,
      confidence: draft.confidence ?? null,
      completenessScore: score,
      reviewTier: draft.reviewTier ?? 'pending',
      imageUrl: draft.imageUrl ?? null,
      sourceUsername: draft.sourceUsername ?? null,
      sourcePostId: draft.sourcePostId ?? null,
      sourceAccountId: draft.sourceAccountId ?? null,
      eventHash: hash,
      updatedAt: new Date(),
    };

    if (existing) {
      // Strictly greater: an equal-scoring re-scrape leaves the existing
      // row alone rather than churning updated_at for no gain.
      if (score <= (existing.completenessScore ?? 0)) return 'kept_existing';

      await tx.update(event).set(value).where(eq(event.eventId, existing.eventId));
      await writeSubEvent(tx, existing.eventId, draft.subEventList);
      return 'updated';
    }

    // No exact hash match. Before inserting, check for the same event
    // written differently — scoped to the same date and the same venue,
    // so two genuinely different gigs on one night stay separate.
    const nearDuplicate = await findNearDuplicate(tx, draft);
    if (nearDuplicate) {
      if (score <= nearDuplicate.completenessScore) return 'kept_existing';

      // The better-described version wins, and keeps the existing row so
      // any saved_event pointing at it survives.
      await tx.update(event).set(value).where(eq(event.eventId, nearDuplicate.eventId));
      await writeSubEvent(tx, nearDuplicate.eventId, draft.subEventList);
      return 'merged';
    }

    const [created] = await tx.insert(event).values(value).returning({ eventId: event.eventId });
    await writeSubEvent(tx, created.eventId, draft.subEventList);
    return 'inserted';
  });
}

/** The parts of a row this decision reads. Same shape either side. */
export interface DuplicateCandidate {
  venueName?: string | null;
  sourceAccountId?: number | null;
}

/**
 * Do these two same-date rows describe one event?
 *
 * Pure and exported so the decision can be tested without a database —
 * it is the part that loses events when it is wrong.
 *
 * A shared venue is the strongest signal. When one side has no venue —
 * which happens when the same event is posted twice and the extractor
 * finds a location only once — fall back to a shared account, and demand
 * a near-identical title before merging on that alone.
 */
export function isSameEvent(
  draft: DuplicateCandidate,
  candidate: DuplicateCandidate,
  similarity: number,
): boolean {
  if (similarity < FUZZY_MERGE_THRESHOLD) return false;

  const sameVenue = Boolean(
    draft.venueName && candidate.venueName && draft.venueName === candidate.venueName,
  );
  if (sameVenue) return true;

  // A different named venue is a positive signal they are *not* the same,
  // whatever the titles say: two bars can run the same club night.
  const eitherLackVenue = !draft.venueName || !candidate.venueName;
  if (!eitherLackVenue) return false;

  const sameAccount = Boolean(
    draft.sourceAccountId && candidate.sourceAccountId
    && draft.sourceAccountId === candidate.sourceAccountId,
  );
  return sameAccount && similarity >= VENUELESS_MERGE_THRESHOLD;
}

async function findNearDuplicate(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  draft: EventDraft,
): Promise<{ eventId: number; completenessScore: number } | null> {
  // Same day, same source account. Scoping by date alone would let two
  // unrelated gigs with similar names merge; adding the account keeps it
  // to posts that plausibly describe the same thing.
  const candidateList = await tx.query.event.findMany({
    where: eq(event.eventDate, draft.eventDate),
    columns: {
      eventId: true, title: true, venueName: true,
      completenessScore: true, sourceAccountId: true,
    },
    limit: 200,
  });

  let best: { eventId: number; completenessScore: number; similarity: number } | null = null;

  for (const candidate of candidateList) {
    const similarity = titleSimilarity(draft.title, candidate.title);
    if (!isSameEvent(draft, candidate, similarity)) continue;

    if (!best || similarity > best.similarity) {
      best = {
        eventId: candidate.eventId,
        completenessScore: candidate.completenessScore ?? 0,
        similarity,
      };
    }
  }

  return best ? { eventId: best.eventId, completenessScore: best.completenessScore } : null;
}

/** Replace an event's sub-events. Runs inside the caller's transaction. */
async function writeSubEvent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  eventId: number,
  subEventList: EventDraft['subEventList'],
): Promise<void> {
  await tx.delete(subEvent).where(eq(subEvent.eventId, eventId));

  if (!subEventList?.length) return;

  await tx.insert(subEvent).values(subEventList.map(entry => ({
    eventId,
    title: entry.title,
    eventDate: entry.eventDate ?? null,
    eventTime: entry.eventTime ?? null,
    endTime: entry.endTime ?? null,
    description: entry.description ?? null,
  })));
}

/**
 * Venues that still need geocoding.
 *
 * `geocode_attempted_at` is what stops a permanently unresolvable name
 * being re-queried against Nominatim on every single run — the old
 * script had no such column and retried the same failures forever, at
 * 1.1 seconds each.
 */
export async function listEventNeedingGeocode(limit: number) {
  return db
    .select({
      eventId: event.eventId,
      venueName: event.venueName,
    })
    .from(event)
    .where(and(
      sql`${event.venueLat} IS NULL`,
      sql`${event.venueName} IS NOT NULL`,
    ))
    .limit(limit);
}
