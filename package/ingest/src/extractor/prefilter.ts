/**
 * Free pre-filter, run before any paid extraction call.
 *
 * ## What this does and, more importantly, does not do
 *
 * It rejects only captions that are *obviously* not event listings:
 * throwbacks, giveaways, hiring posts, menu announcements, and anything
 * too short to carry a date and a place. Everything else is sent for
 * extraction.
 *
 * ## Why it is this conservative
 *
 * The first version of this file scored positive signals (date, time,
 * venue marker, price, event hashtag) and required two before paying to
 * extract. Measured against the 5,652 recovered captions, that threshold
 * would have dropped **1,023 of 2,398 known events — 42.7%** — to save
 * $3.40 on a full pass. Lower thresholds were no better a trade:
 *
 *   threshold  saving/pass  events lost
 *   1 signal   $2.17        429  (17.9%)
 *   2 signals  $3.40        1023 (42.7%)
 *   3 signals  $4.07        1606 (67.0%)
 *   anti-only  $0.43        122  (5.1%)
 *
 * An extraction costs about $0.00085. A missed event is missing from the
 * product until someone notices, which nobody does. Those are not
 * comparable quantities, so the filter is tuned to almost never reject.
 *
 * The real saving is not here: it is `store/cost.ts`, which skips posts
 * already extracted at the current prompt version. That mechanism is
 * lossless and cuts steady-state spend by roughly 40x.
 */

/**
 * Phrases that mean this is not an event listing.
 *
 * Kept narrow and literal. Each one was checked against the recovered
 * corpus; together they reject 509 posts and cost 122 events, and those
 * 122 are mostly recap posts the old pipeline had mislabelled as events
 * in the first place.
 */
const NOT_AN_EVENT_PATTERN =
  /\b(thank you|thanks to everyone|thanks everyone|what a night|#tbt|#throwback|throwback to|giveaway|raffle|tag \d+ friends?|now hiring|we are hiring|join our team|new on the menu|now available in|grand opening soon)\b/i;

/**
 * Below this, a caption cannot carry a date, a time and a place.
 *
 * Deliberately low. Some legitimate listings are terse — a poster image
 * carrying the detail with a one-line caption underneath — and those are
 * exactly the ones worth spending a model call on.
 */
const MIN_CAPTION_LENGTH = 30;

export interface PrefilterResult {
  isWorthExtracting: boolean;
  /** Populated when rejected, for logging and tuning. */
  reason: string | null;
}

/**
 * Decide whether a caption is worth an extraction call.
 *
 * `hashtagList` is accepted for symmetry with the scraper's output and
 * for future tuning; the current rules do not consult it, because every
 * hashtag-based rule tested made the false-negative rate worse.
 */
export function prefilterCaption(
  caption: string | null | undefined,
  _hashtagList: string[] = [],
): PrefilterResult {
  if (!caption || caption.trim().length < MIN_CAPTION_LENGTH) {
    return { isWorthExtracting: false, reason: 'caption too short to hold an event' };
  }

  if (NOT_AN_EVENT_PATTERN.test(caption)) {
    return { isWorthExtracting: false, reason: 'matches a non-event phrase' };
  }

  return { isWorthExtracting: true, reason: null };
}
