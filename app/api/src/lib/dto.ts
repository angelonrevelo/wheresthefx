/**
 * Response shaping.
 *
 * ## Why `id` is added back
 *
 * The schema uses `{table}_id` primary keys, per the naming convention.
 * That is right for SQL — `event.event_id` reads correctly in a join, and
 * `id` does not. It is wrong for a JSON payload, where `event_id` inside
 * an object that is already an event is redundant, and where every
 * existing client reads `id`.
 *
 * Renaming the column silently changed the public contract: the map
 * endpoint kept working because its query aliases the column, but
 * `/api/events` went from `id` to `event_id` and the sidebar started
 * reading `undefined`. Nothing failed loudly; cards just lost their keys.
 *
 * So the column stays `event_id` and the API keeps promising `id`. The
 * database convention and the wire contract are allowed to differ.
 */

/** A row carrying a `{table}_id` style primary key. */
type RowWithId = Record<string, unknown>;

/**
 * Expose `id` alongside the underlying `{entity}_id`.
 *
 * Both are emitted rather than renaming, so a consumer written against
 * either spelling keeps working.
 */
export function withId<T extends RowWithId>(row: T, key: keyof T & string): T & { id: unknown } {
  return { ...row, id: row[key] };
}

/** `withId` over a list. */
export function withIdList<T extends RowWithId>(
  rowList: T[],
  key: keyof T & string,
): (T & { id: unknown })[] {
  return rowList.map(row => withId(row, key));
}
