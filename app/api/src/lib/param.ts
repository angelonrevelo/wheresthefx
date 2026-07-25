/**
 * Request-parameter parsing.
 *
 * Express types both `req.params[k]` and `req.query[k]` as
 * `string | string[]` — a repeated key (`?category=a&category=b`) really
 * does arrive as an array. The routes previously ignored that, passing
 * the value straight into a Drizzle enum comparison, so a repeated query
 * param produced a Postgres type error surfaced as a **500**.
 *
 * These helpers collapse that ambiguity in one place and return
 * `undefined` for anything unusable, so routes can answer 400.
 */

/** First value if repeated, `undefined` if absent or empty. */
export function firstParam(value: unknown): string | undefined {
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' && entry !== '');
    return typeof first === 'string' ? first : undefined;
  }
  return undefined;
}

/**
 * Parse a positive integer id.
 *
 * Uses `Number` rather than `parseInt` deliberately: `parseInt('12abc')`
 * returns 12, which would silently accept a malformed id.
 */
export function parseId(value: unknown): number | undefined {
  const raw = firstParam(value);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return undefined;
  return parsed;
}

/** Parse an integer within `[min, max]`, falling back to `fallback`. */
export function parseBoundedInt(
  value: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  const raw = firstParam(value);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/** Parse `"true"` / `"false"`; anything else is `undefined` (no filter). */
export function parseBool(value: unknown): boolean | undefined {
  const raw = firstParam(value);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

/** `YYYY-MM-DD`, validated as a real calendar date. */
export function parseIsoDate(value: unknown): string | undefined {
  const raw = firstParam(value);
  if (raw === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  // Round-trips through Date to reject 2026-02-31 and friends.
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10) === raw ? raw : undefined;
}

/**
 * Escape a user-supplied ILIKE search term.
 *
 * `%` and `_` are wildcards. Unescaped, `?search=%` matches every row and
 * forces a full scan on an unindexed column — a free DoS on a public,
 * unauthenticated endpoint.
 */
export function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
