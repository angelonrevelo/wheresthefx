/**
 * Ingest freshness, extracted so it can be tested.
 *
 * This lived inline in the health route and was wrong: it assumed the
 * driver returned a `Date` for `completed_at`, but the value arrives as
 * a string. `.toISOString()` threw, a catch swallowed it, and the
 * endpoint reported "never synced" — which looks exactly like a dead
 * pipeline. A monitor that fails closed *into the alarm state* is not
 * obviously broken, so it stayed wrong through several deploys.
 */

/** Beyond this with no completed sync, the data is going stale. */
export const INGEST_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface IngestFreshness {
  lastSyncAt: string | null;
  isStale: boolean;
}

/**
 * Interpret the most recent completed sync timestamp.
 *
 * Accepts whatever the driver hands over — `Date`, string, or null —
 * because which one it is has already caused a silent outage once.
 */
export function readIngestFreshness(
  rawCompletedAt: Date | string | null | undefined,
  now: number = Date.now(),
): IngestFreshness {
  if (rawCompletedAt === null || rawCompletedAt === undefined) {
    return { lastSyncAt: null, isStale: true };
  }

  const completedAt = rawCompletedAt instanceof Date
    ? rawCompletedAt
    : new Date(rawCompletedAt);

  if (Number.isNaN(completedAt.getTime())) {
    return { lastSyncAt: null, isStale: true };
  }

  return {
    lastSyncAt: completedAt.toISOString(),
    isStale: now - completedAt.getTime() > INGEST_STALE_AFTER_MS,
  };
}
