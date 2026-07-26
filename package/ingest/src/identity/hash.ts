import { createHash } from 'node:crypto';

/**
 * Event identity and quality scoring.
 *
 * `eventHash` is the deduplication key. It has to be stable across
 * re-scrapes and across accounts: the same gig posted by the venue, the
 * promoter, and the headliner must collapse to one row, even though all
 * three write the title differently.
 *
 * That is what the normalisation below is for. `"Karpos Live presents:
 * Men I Trust"`, `"Men I Trust at SMX"`, and `"MEN I TRUST 2026"` all
 * reduce to the same key.
 */

/**
 * Reduce a title or venue to its identity-bearing core.
 *
 * Order matters. Punctuation is stripped before the suffix rules run, so
 * `"Men I Trust @ SMX"` has lost its `@` by the time the venue-suffix
 * rule fires — which is why that rule also matches a bare `at`/`in`.
 */
function normalizeForHash(value: string): string {
  return value
    .toLowerCase()
    .replace(/['‘’ʼ`´]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    // "Karpos Live presents: X" and "X presents Y" both reduce to the act.
    .replace(/^.*?\bpresents?\s*/i, '')
    // "... at SMX", "... in Makati"
    .replace(/\s+(?:at|@|in)\s+.+$/i, '')
    // Trailing year: the date is already part of the key.
    .replace(/\s+20\d{2}\s*$/i, '')
    // Generic event-word suffixes that carry no identity.
    .replace(/\s+(?:night|event|show|party|live|edition|pop\s*up|day\s*\d+)\s*$/i, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Stable dedup key for an event.
 *
 * Truncated to 32 hex chars: still 128 bits, which is far beyond any
 * plausible collision risk at this corpus size, and half the storage.
 */
export function eventHash(title: string, date: string, venue: string | null | undefined): string {
  const input = `${normalizeForHash(title)}|${date}|${normalizeForHash(venue ?? '')}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

/** Looser normalisation for fuzzy comparison; keeps word boundaries. */
function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    // "&" and "and" are the same word to a reader and to a promoter, who
    // will use both across two posts for one event. Unified before the
    // character strip, which would otherwise delete the ampersand and
    // leave a token count mismatch.
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^.*?\bpresents?\s*/i, '')
    .replace(/\s+(?:at|@|in)\s+.+$/i, '')
    .trim();
}

/**
 * Title similarity in [0,1], for catching near-duplicates the hash misses.
 *
 * Combines Jaccard overlap with a containment bonus, because a short
 * title fully contained in a longer one ("Men I Trust" inside "Men I
 * Trust Asia Tour") is usually the same event even though Jaccard scores
 * it poorly.
 */
export function titleSimilarity(a: string, b: string): number {
  const left = normalizeForCompare(a);
  const right = normalizeForCompare(b);

  if (left === right) return 1;
  if (left === '' || right === '') return 0;

  // Whole-string containment, guarded on length so "a" inside "art fair"
  // does not score 0.9.
  if (left.length >= 5 && right.length >= 5 && (left.includes(right) || right.includes(left))) {
    return 0.9;
  }

  // Tokens of 3+ chars; shorter ones are filler.
  const leftToken = left.split(' ').filter(token => token.length > 2);
  const rightToken = right.split(' ').filter(token => token.length > 2);
  if (leftToken.length === 0 || rightToken.length === 0) return 0;

  const rightSet = new Set(rightToken);
  let intersection = 0;
  for (const token of leftToken) if (rightSet.has(token)) intersection++;

  const jaccard = intersection / (leftToken.length + rightToken.length - intersection);

  const shorter = leftToken.length <= rightToken.length ? leftToken : rightToken;
  const longerSet = leftToken.length <= rightToken.length ? rightSet : new Set(leftToken);
  let contained = 0;
  for (const token of shorter) if (longerSet.has(token)) contained++;

  // Containment is discounted so it can never beat an exact match.
  return Math.max(jaccard, (contained / shorter.length) * 0.85);
}

/** Fields that contribute to completeness, and what each is worth. */
export interface ScorableEvent {
  title?: string | null;
  eventDate?: string | null;
  eventTime?: string | null;
  venueName?: string | null;
  price?: number | null;
  isFree?: boolean | null;
  signupUrl?: string | null;
  imageUrl?: string | null;
  description?: string | null;
  category?: string | null;
  artist?: string[] | null;
}

/**
 * Completeness in [0,1].
 *
 * This is the tie-breaker when two sources describe the same event: the
 * more complete record wins. The ingest previously computed this and
 * then ignored it, overwriting good rows with worse ones on every
 * re-scrape despite the documented rule saying otherwise.
 *
 * Weights favour the fields a user actually needs to decide whether to
 * go: what, when, where. Description and category are worth least
 * because they are the easiest to infer.
 */
export function completenessScore(event: ScorableEvent): number {
  let score = 0;
  if (event.title) score += 0.15;
  if (event.eventDate) score += 0.15;
  if (event.venueName) score += 0.15;
  if (event.eventTime) score += 0.10;
  if (event.price !== null && event.price !== undefined) score += 0.10;
  else if (event.isFree !== null && event.isFree !== undefined) score += 0.10;
  if (event.signupUrl) score += 0.10;
  if (event.imageUrl) score += 0.10;
  if (event.description) score += 0.05;
  if (event.category) score += 0.05;
  if (event.artist?.length) score += 0.05;
  return Math.round(score * 100) / 100;
}

/** Review tier thresholds. */
export type ReviewTier = 'ready' | 'quick' | 'full' | 'rejected' | 'pending';

/**
 * Assign a review tier from confidence and completeness.
 *
 * The public API serves only `ready` and `quick`. This is the single
 * biggest lever on perceived data quality, and it was computed and then
 * read by nothing — `/api/events` served rejected rows identically.
 */
export function assignReviewTier(confidence: number, event: ScorableEvent): ReviewTier {
  if (confidence < 0.4) return 'rejected';

  const hasCore = Boolean(event.title && event.eventDate && event.venueName && event.eventTime);
  if (confidence >= 0.85 && hasCore) return 'ready';

  if (confidence >= 0.65 && event.title && event.eventDate) return 'quick';

  return 'full';
}
