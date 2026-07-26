import '../env.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, sql as pgConnection, venue } from '@wheresthefx/db';
import { isNotNull } from 'drizzle-orm';
import { normalizeVenueName } from '../store/venue.js';
import { metreApart } from '../store/venueMerge.js';

/**
 * Check our venue coordinates against OpenStreetMap.
 *
 *   npx tsx package/ingest/src/command/verify-venue-pin.ts
 *
 * ## Why
 *
 * Every coordinate in the directory came from Nominatim, which answers
 * whatever it is asked. Ask it for "Activity Center" and it returns a
 * plausible point in Metro Manila rather than nothing — which is how
 * fourteen events came within one commit of sharing an invented location.
 * Guards stop the obviously generic; nothing checks the rest.
 *
 * OSM is an independent second opinion built by people who stood in the
 * place. Where the two agree the pin is trustworthy. Where they disagree
 * by more than a block, Nominatim is the one that guessed.
 *
 * ## It reports and does not fix
 *
 * The first version applied OSM's coordinate automatically and would have
 * done more harm than good. A name match cannot tell "our pin is wrong"
 * apart from "different place, same name", and the run found both:
 *
 * - "19 East" and "Nokal", the two busiest venues in the directory, were
 *   both genuinely misplaced — Nominatim had put 19 East in Bel-Air
 *   rather than on Sucat Road, and Nokal in a Makati Square parking
 *   basement rather than Poblacion. 87 events sat at the wrong point.
 * - "Mood Coffee", "Escolta" and "Tipple and Slaw Katipunan" were all
 *   correct, and matched an unrelated OSM place with the same name.
 *
 * Auto-fixing would have broken three right pins to repair two wrong
 * ones. Twelve rows is a couple of minutes of human attention, and a
 * person can tell a misplaced venue from a namesake at a glance.
 */

const GAZETTEER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixture/osm-venue.json',
);

/** Past this, the two sources are describing different places. */
const DISAGREEMENT_METRE = 250;

/**
 * Venue types whose extent makes a centroid difference meaningless.
 *
 * A mall or a park is hundreds of metres across, so Nominatim pointing at
 * the entrance and OSM at the centroid is not an error by either.
 */
const WIDE_FOOTPRINT = new Set(['mall', 'active', 'market']);

interface OsmVenue {
  name: string;
  aliasList: string[];
  lat: number;
  lng: number;
  slug: string;
  osmId: string;
}

async function main(): Promise<void> {
  const gazetteer: OsmVenue[] = JSON.parse(readFileSync(GAZETTEER_PATH, 'utf8'));

  // Name to entry. A name held by more than one place — every branch of a
  // chain — is dropped rather than guessed at.
  const byName = new Map<string, OsmVenue | null>();
  for (const entry of gazetteer) {
    for (const label of [entry.name, ...entry.aliasList]) {
      const key = normalizeVenueName(label);
      if (!key) continue;
      byName.set(key, byName.has(key) ? null : entry);
    }
  }

  const ourList = await db
    .select({
      venueId: venue.venueId,
      name: venue.name,
      alias: venue.alias,
      lat: venue.lat,
      lng: venue.lng,
    })
    .from(venue)
    .where(isNotNull(venue.lat));

  let matched = 0;
  let agreed = 0;
  const disagreeList: { row: typeof ourList[number]; osm: OsmVenue; distance: number }[] = [];

  for (const row of ourList) {
    const candidate = [row.name, ...(row.alias ?? [])]
      .map(label => byName.get(normalizeVenueName(label)))
      .find(entry => entry);
    if (!candidate) continue;

    matched++;
    const distance = metreApart(row, { ...candidate, venueId: 0, alias: null, lng: candidate.lng });
    if (distance === null) continue;

    if (distance <= DISAGREEMENT_METRE) {
      agreed++;
      continue;
    }
    disagreeList.push({ row, osm: candidate, distance });
  }

  console.log(
    `${ourList.length} pinned venue(s), ${matched} found in OSM, `
    + `${agreed} agree within ${DISAGREEMENT_METRE}m, ${disagreeList.length} disagree\n`,
  );

  console.log('Each line is a question, not a defect. Compare the two points:');
  for (const { row, osm, distance } of disagreeList.sort((a, b) => b.distance - a.distance)) {
    const note = WIDE_FOOTPRINT.has(osm.slug) ? '  [wide footprint, a centroid gap is expected]' : '';
    console.log(
      `  ${String(distance).padStart(6)}m  ${row.name.padEnd(30)} `
      + `ours ${row.lat?.toFixed(5)},${row.lng?.toFixed(5)}  `
      + `osm ${osm.lat.toFixed(5)},${osm.lng.toFixed(5)} (${osm.slug})${note}`,
    );
  }

  await pgConnection.end({ timeout: 5 });
}

void main();
