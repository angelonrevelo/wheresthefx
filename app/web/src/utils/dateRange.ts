import { manilaDateOffset, manilaToday } from "@wheresthefx/core";

/** The date presets offered in the filter bar. */
export type DatePreset = "all" | "today" | "week" | "weekend" | "month";

/** An inclusive `YYYY-MM-DD` range, in Manila time. */
export interface DateRange {
  start: string;
  end: string;
}

/**
 * Resolve a preset to a concrete date range.
 *
 * This logic was previously duplicated verbatim in two handlers in
 * MapFilters, and both copies built `Date` objects in the *browser's*
 * timezone — so a user abroad, or one whose clock is set differently,
 * got a different "today" than the API's. Ranges are now computed as
 * Manila date strings on both sides of the wire.
 */
export function resolveDateRange(
  preset: DatePreset,
  now: Date = new Date(),
): DateRange | undefined {
  const today = manilaToday(now);

  switch (preset) {
    case "today":
      return { start: today, end: today };

    case "week":
      return { start: today, end: manilaDateOffset(7, now) };

    case "weekend": {
      // Upcoming Friday through Sunday. On a Friday or Saturday this
      // means *this* weekend, not next — someone asking on Friday night
      // wants tonight.
      const dayOfWeek = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=Sun
      const dayUntilFriday = (5 - dayOfWeek + 7) % 7;
      const start = manilaDateOffset(dayUntilFriday, now);
      const end = manilaDateOffset(dayUntilFriday + 2, now);
      return { start, end };
    }

    case "month":
      return { start: today, end: manilaDateOffset(30, now) };

    case "all":
    default:
      return undefined;
  }
}
