/**
 * Manila-time helpers.
 *
 * ## The bug this replaces
 *
 * Four call sites computed "today" as:
 *
 * ```ts
 * new Date().toISOString().split('T')[0]
 * ```
 *
 * `toISOString()` is always UTC. Manila is UTC+8. So for the first eight
 * hours of every Manila day — 00:00 to 08:00 PHT, which is precisely when
 * people are getting home from the events this product indexes — the API
 * computed "today" as *yesterday*. `/api/events/upcoming` therefore served
 * a day that had already ended and filtered out events happening that
 * night. Every day. For the whole life of the product.
 *
 * These helpers do the arithmetic in the venue's timezone, which is the
 * only timezone that means anything for a Metro Manila event.
 */

/** IANA zone for Metro Manila (UTC+8, no DST). */
export const MANILA_TIMEZONE = 'Asia/Manila';

/**
 * `en-CA` is used deliberately: its short date format is ISO-ordered
 * (YYYY-MM-DD), so no manual part-reassembly or zero-padding is needed.
 */
const ISO_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: MANILA_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Today's date in Manila, as `YYYY-MM-DD`.
 *
 * This is the correct boundary for "upcoming" queries against
 * `event.event_date`, which is a bare `date` column with no zone.
 *
 * @param now Instant to evaluate. Injectable so tests can pin it.
 */
export function manilaToday(now: Date = new Date()): string {
  return ISO_DATE_FORMATTER.format(now);
}

/**
 * A Manila date offset by whole days, as `YYYY-MM-DD`.
 *
 * Day arithmetic is done on the *formatted* Manila date rather than by
 * adding milliseconds to the instant, so it cannot drift across a zone
 * boundary. Manila has no DST, but this keeps the intent explicit.
 *
 * @param dayOffset Days to add. Negative moves into the past.
 */
export function manilaDateOffset(dayOffset: number, now: Date = new Date()): string {
  const [year, month, day] = manilaToday(now).split('-').map(Number);
  // Constructed as UTC midnight so the offset arithmetic is pure day-count
  // and never touches a local-time transition.
  const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset));
  return shifted.toISOString().slice(0, 10);
}

/** True when `date` (a `YYYY-MM-DD` string) is today or later in Manila. */
export function isUpcomingInManila(date: string, now: Date = new Date()): boolean {
  return date >= manilaToday(now);
}
