import { db, venue } from '@wheresthefx/db';
import { eq } from 'drizzle-orm';

/**
 * Venue persistence and matching.
 *
 * A venue arrives from extraction as free text, spelled however the
 * poster felt: "19 East", "19East", "19 East Bar". Resolving those to
 * one row is what makes the map show three events at one pin instead of
 * three pins a few metres apart.
 */

export interface VenueDraft {
  name: string;
  alias?: string[] | null;
  address?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  instagramHandle?: string | null;
}

/**
 * Case- and punctuation-insensitive form used for matching.
 *
 * The apostrophe class is written with explicit escapes because it
 * originally contained only U+0027 while looking like it covered smart
 * quotes too. Instagram captions are full of U+2019, so "Mow's Bar" and
 * "Mow’s Bar" resolved to different venues, and — via the same bug in
 * `eventHash` — to duplicate events.
 */
export function normalizeVenueName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['‘’ʼ`´]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface VenueRecord {
  venueId: number;
  name: string;
  alias: string[] | null;
  lat: number | null;
  lng: number | null;
}

/**
 * In-memory index over the venue directory.
 *
 * Built once per run. Matching a few thousand extracted venue strings
 * against a few hundred rows one query at a time would be thousands of
 * round trips for data that fits comfortably in memory.
 */
export class VenueIndex {
  private readonly byNormalizedName = new Map<string, VenueRecord>();

  constructor(recordList: VenueRecord[]) {
    for (const record of recordList) {
      this.byNormalizedName.set(normalizeVenueName(record.name), record);
      for (const alias of record.alias ?? []) {
        const key = normalizeVenueName(alias);
        // An alias never displaces a real name.
        if (!this.byNormalizedName.has(key)) this.byNormalizedName.set(key, record);
      }
    }
  }

  /**
   * Resolve a venue string.
   *
   * Exact and alias matches only. Fuzzy containment matching is
   * deliberately not done here: it is what produced "Jazz Night at Bar A"
   * and "Jazz Night at Bar B" collapsing into one event, and a wrong
   * merge is far more damaging than a missed one, because the losing
   * event simply disappears from the map.
   */
  match(rawName: string | null | undefined): VenueRecord | null {
    if (!rawName) return null;
    return this.byNormalizedName.get(normalizeVenueName(rawName)) ?? null;
  }

  get size(): number {
    return this.byNormalizedName.size;
  }
}

export async function loadVenueIndex(): Promise<VenueIndex> {
  const recordList = await db.select({
    venueId: venue.venueId,
    name: venue.name,
    alias: venue.alias,
    lat: venue.lat,
    lng: venue.lng,
  }).from(venue);

  return new VenueIndex(recordList);
}

/**
 * Insert or update a venue, resolving by normalised name first.
 *
 * The unique constraint is on the raw `name`, so "Homebase", "HOMEBASE",
 * "the_funroof" and "The Funroof" each inserted a separate row — the
 * directory accumulated a dozen duplicates that way. Matching on the
 * normalised form first means a new spelling is recorded as an *alias*
 * of the venue that already exists rather than becoming a second one.
 *
 * Coordinates are only overwritten when the incoming row actually has
 * them: a later scrape that happens not to include lat/lng must not wipe
 * a geocode that already succeeded.
 */
export async function upsertVenue(draft: VenueDraft): Promise<number> {
  const normalizedName = normalizeVenueName(draft.name);

  // Scan for an existing row whose name or alias normalises the same way.
  const existingList = await db
    .select({ venueId: venue.venueId, name: venue.name, alias: venue.alias })
    .from(venue);

  const existing = existingList.find(row =>
    normalizeVenueName(row.name) === normalizedName
    || (row.alias ?? []).some(alias => normalizeVenueName(alias) === normalizedName),
  );

  if (existing) {
    // Record the new spelling as an alias, so the variant is known
    // without becoming a row.
    const aliasList = [...(existing.alias ?? [])];
    const isNewSpelling = normalizeVenueName(existing.name) !== normalizedName
      && !aliasList.some(alias => normalizeVenueName(alias) === normalizedName);
    if (isNewSpelling) aliasList.push(draft.name);

    for (const alias of draft.alias ?? []) {
      const key = normalizeVenueName(alias);
      if (key === normalizeVenueName(existing.name)) continue;
      if (aliasList.some(known => normalizeVenueName(known) === key)) continue;
      aliasList.push(alias);
    }

    await db.update(venue).set({
      alias: aliasList,
      ...(draft.address ? { address: draft.address } : {}),
      ...(draft.city ? { city: draft.city } : {}),
      ...(draft.lat !== null && draft.lat !== undefined ? { lat: draft.lat } : {}),
      ...(draft.lng !== null && draft.lng !== undefined ? { lng: draft.lng } : {}),
      ...(draft.instagramHandle ? { instagramHandle: draft.instagramHandle } : {}),
      updatedAt: new Date(),
    }).where(eq(venue.venueId, existing.venueId));

    return existing.venueId;
  }

  const [row] = await db.insert(venue)
    .values({
      name: draft.name,
      alias: draft.alias ?? [],
      address: draft.address ?? null,
      city: draft.city ?? null,
      lat: draft.lat ?? null,
      lng: draft.lng ?? null,
      instagramHandle: draft.instagramHandle ?? null,
    })
    .onConflictDoUpdate({
      target: venue.name,
      set: {
        alias: draft.alias ?? [],
        address: draft.address ?? null,
        city: draft.city ?? null,
        ...(draft.lat !== null && draft.lat !== undefined ? { lat: draft.lat } : {}),
        ...(draft.lng !== null && draft.lng !== undefined ? { lng: draft.lng } : {}),
        instagramHandle: draft.instagramHandle ?? null,
        updatedAt: new Date(),
      },
    })
    .returning({ venueId: venue.venueId });

  return row.venueId;
}

/** Record a geocode result, successful or not. */
export async function recordGeocode(
  venueId: number,
  coordinate: { lat: number; lng: number } | null,
): Promise<void> {
  await db.update(venue).set({
    ...(coordinate ? { lat: coordinate.lat, lng: coordinate.lng } : {}),
    // Stamped either way. A permanent failure must stop being retried at
    // 1.1 seconds a go on every subsequent run.
    geocodeAttemptedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(venue.venueId, venueId));
}
