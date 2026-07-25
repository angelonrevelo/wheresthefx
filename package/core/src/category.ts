/**
 * Event taxonomy — the single canonical category set.
 *
 * ## Why this file exists
 *
 * Before the monorepo, three different category sets were live at once:
 *
 * 1. The pipeline's canonical 12 (blead `parsers/caption-parser.ts`)
 * 2. A stale 9-value set in the SQLite schema comment, still naming `art_culture`
 * 3. A 9-value Postgres enum in blead's `sync-to-postgres.ts`
 *
 * That third one mapped `arts`, `film`, `sports`, `fitness`, and `tech`
 * to `'other'` on the way into Postgres — so five of twelve categories
 * were being lossily collapsed on every single ingest run. Events tagged
 * `film` by the extractor arrived in the product as `other`.
 *
 * This module is now the only place a category is defined. The Postgres
 * enum, the API response, the filter chips, and the extraction prompt all
 * derive from it.
 */

/** The canonical categories, in display order. */
export const CATEGORY = [
  'nightlife',
  'music',
  'arts',
  'film',
  'comedy',
  'food',
  'markets',
  'sports',
  'fitness',
  'workshops',
  'tech',
  'community',
] as const;

export type Category = (typeof CATEGORY)[number];

/**
 * Legacy enum values that still exist in the production Postgres type.
 *
 * They are retained so existing rows remain readable, but nothing should
 * ever write them. `normalizeCategory` maps them onto live values; a
 * backfill migration retires them once no row references them.
 */
export const LEGACY_CATEGORY = ['art_culture', 'gaming', 'other'] as const;

export type LegacyCategory = (typeof LEGACY_CATEGORY)[number];

/** Display metadata, keyed by canonical value. */
export const CATEGORY_META: Record<Category, { label: string; emoji: string }> = {
  nightlife: { label: 'Nightlife', emoji: '🌙' },
  music: { label: 'Music', emoji: '🎵' },
  arts: { label: 'Arts', emoji: '🎨' },
  film: { label: 'Film', emoji: '🎬' },
  comedy: { label: 'Comedy', emoji: '😂' },
  food: { label: 'Food', emoji: '🍜' },
  markets: { label: 'Markets', emoji: '🛍️' },
  sports: { label: 'Sports', emoji: '🏀' },
  fitness: { label: 'Fitness', emoji: '💪' },
  workshops: { label: 'Workshops', emoji: '🎓' },
  tech: { label: 'Tech', emoji: '💻' },
  community: { label: 'Community', emoji: '🤝' },
};

/** How each retired value maps onto the canonical set. */
const LEGACY_ALIAS: Record<LegacyCategory, Category> = {
  // `art_culture` predates the arts/film split; arts is the closer parent.
  art_culture: 'arts',
  // `gaming` was folded into tech when the taxonomy went to 12.
  gaming: 'tech',
  // `other` has no better home than community — but see `isLegacyCategory`:
  // callers that care about extraction quality should treat it as unknown
  // rather than silently accepting this mapping.
  other: 'community',
};

const CATEGORY_SET = new Set<string>(CATEGORY);
const LEGACY_SET = new Set<string>(LEGACY_CATEGORY);

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && CATEGORY_SET.has(value);
}

export function isLegacyCategory(value: unknown): value is LegacyCategory {
  return typeof value === 'string' && LEGACY_SET.has(value);
}

/**
 * Coerce an arbitrary value to a canonical category.
 *
 * Returns `null` rather than guessing when the value is unrecognised.
 * Callers decide what an unknown category means: the ingest should count
 * it as a skipped row and surface it, because a new value appearing here
 * means the extractor invented a category the taxonomy does not cover —
 * and silently defaulting it to `other` is exactly how the previous
 * pipeline lost five categories without anyone noticing.
 */
export function normalizeCategory(value: unknown): Category | null {
  if (isCategory(value)) return value;
  if (isLegacyCategory(value)) return LEGACY_ALIAS[value];
  return null;
}
