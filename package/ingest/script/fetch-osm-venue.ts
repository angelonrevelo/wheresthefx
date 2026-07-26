import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build a local gazetteer of Metro Manila event venues from OpenStreetMap.
 *
 *   npx tsx package/ingest/script/fetch-osm-venue.ts
 *
 * ## Why
 *
 * Geocoding runs through Nominatim, which answers every question whether
 * or not it knows: a generic name gets a plausible coordinate rather than
 * nothing, and that is how fourteen events nearly landed at an invented
 * point for "Activity Center". Bounds and generic-name guards stop the
 * worst of it, but there is no second opinion on the coordinates that do
 * get written.
 *
 * OSM is that second opinion, and unlike Nominatim it can be held
 * locally: one fetch, no rate limit, and a name-and-coordinate pair that
 * a human contributor put there deliberately.
 *
 * ## Categories
 *
 * The sibling `maphy` repo already extracts Philippine POIs this way, but
 * for civic infrastructure — schools, hospitals, police, worship. Those
 * are the wrong 51,000 places. Bars, galleries, theatres and music venues
 * are exactly what it leaves out and exactly what this product is about,
 * so the query differs even though the machinery is the same.
 */

const OUT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixture',
  'osm-venue.json',
);

const OVERPASS = 'https://overpass-api.de/api/interpreter';

/**
 * Metro Manila plus the fringe the scene actually reaches — Antipolo,
 * Alabang, Tagaytay southward. Wider than the geocoder's accept-bounds so
 * a venue just outside can still be recognised and then rejected on its
 * own merits.
 */
const BBOX = '14.10,120.85,14.85,121.20';

interface Category {
  key: string;
  valueList: string[];
  slug: string;
}

const CATEGORY_LIST: Category[] = [
  { key: 'amenity', valueList: ['bar', 'pub', 'nightclub', 'biergarten'], slug: 'nightlife' },
  { key: 'amenity', valueList: ['cafe', 'restaurant', 'food_court'], slug: 'food' },
  { key: 'amenity', valueList: ['theatre', 'arts_centre', 'cinema'], slug: 'stage' },
  { key: 'amenity', valueList: ['community_centre', 'events_venue', 'conference_centre'], slug: 'venue' },
  { key: 'amenity', valueList: ['marketplace'], slug: 'market' },
  { key: 'tourism', valueList: ['gallery', 'museum'], slug: 'gallery' },
  { key: 'leisure', valueList: ['sports_centre', 'fitness_centre', 'stadium', 'park'], slug: 'active' },
  { key: 'shop', valueList: ['mall'], slug: 'mall' },
];

interface OsmElement {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OsmVenue {
  name: string;
  aliasList: string[];
  lat: number;
  lng: number;
  slug: string;
  osmId: string;
}

function buildQuery(category: Category): string {
  // nwr rather than node: a mall or a theatre is usually mapped as a way
  // or a relation, and `out center` gives those a usable point.
  const filter = category.valueList
    .map(value => `nwr["${category.key}"="${value}"](${BBOX});`)
    .join('\n  ');
  return `[out:json][timeout:180];\n(\n  ${filter}\n);\nout center tags;`;
}

async function fetchCategory(category: Category): Promise<OsmElement[]> {
  const body = new URLSearchParams({ data: buildQuery(category) });

  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch(OVERPASS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Overpass answers an anonymous client with 406. Identifying the
        // caller is its stated expectation for a donated service, not a
        // workaround.
        'User-Agent': 'wheresthefx/1.0 (Metro Manila event map; contact@advo.ph)',
      },
      body: body.toString(),
    });

    if (response.ok) {
      const payload = await response.json() as { elements: OsmElement[] };
      return payload.elements;
    }

    // Overpass sheds load aggressively and says so with 429/504. Backing
    // off is the documented answer; failing the run is not.
    if (response.status === 429 || response.status === 504) {
      const wait = 5000 * attempt;
      console.log(`  ${category.slug}: ${response.status}, retrying in ${wait / 1000}s`);
      await new Promise(resolve => setTimeout(resolve, wait));
      continue;
    }

    throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
  }

  throw new Error(`${category.slug}: retries exhausted`);
}

async function main(): Promise<void> {
  const byOsmId = new Map<string, OsmVenue>();

  for (const category of CATEGORY_LIST) {
    const elementList = await fetchCategory(category);

    let kept = 0;
    for (const element of elementList) {
      const name = element.tags?.name?.trim();
      // A venue with no name cannot be matched against an extracted
      // string, so it is weight without value.
      if (!name) continue;

      const lat = element.lat ?? element.center?.lat;
      const lng = element.lon ?? element.center?.lon;
      if (lat === undefined || lng === undefined) continue;

      const osmId = `${element.type}/${element.id}`;
      if (byOsmId.has(osmId)) continue;

      // OSM records the other things a place is called, which is exactly
      // the alias data that otherwise has to be curated by hand.
      const aliasList = [
        element.tags?.['alt_name'],
        element.tags?.['short_name'],
        element.tags?.['old_name'],
        element.tags?.['name:en'],
      ]
        .filter((value): value is string => Boolean(value?.trim()))
        .map(value => value.trim())
        .filter(value => value !== name);

      byOsmId.set(osmId, {
        name,
        aliasList: [...new Set(aliasList)],
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        slug: category.slug,
        osmId,
      });
      kept++;
    }

    console.log(`${category.slug.padEnd(10)} ${String(elementList.length).padStart(6)} found, ${kept} named`);
    // Courtesy pause between categories; Overpass is a donated resource.
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  const venueList = [...byOsmId.values()].sort((a, b) => a.name.localeCompare(b.name));
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(venueList, null, 0)}\n`, 'utf8');

  console.log(`\n${venueList.length} named venue(s) written to ${OUT_PATH}`);
}

void main();
