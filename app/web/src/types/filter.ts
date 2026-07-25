import type { DateRange } from "@/utils/dateRange";

/**
 * The map's active filter set.
 *
 * This was `useState<any>({})` with no shape at all, which is how the
 * date and price handlers came to *replace* the whole object — silently
 * discarding the `interestTags` written by onboarding and the `category`
 * written by the chip row.
 */
export type PriceFilter = "all" | "free" | "paid";

export interface EventFilter {
  dateRange?: DateRange;
  priceFilter?: PriceFilter;
  category?: string;
  interestTags?: string[];
}

/** Partial update merged over the current filter set. */
export type EventFilterPatch = Partial<EventFilter>;
