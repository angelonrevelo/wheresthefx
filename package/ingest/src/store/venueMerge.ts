import { titleSimilarity } from '../identity/hash.js';
import { normalizeVenueName } from './venue.js';

/**
 * Deciding which venue rows are the same place.
 *
 * Kept apart from the command that performs the merge because a wrong
 * answer here is unrecoverable: the losing row is deleted and its events
 * are repointed. Every rule below is exercised against the real
 * duplicates found in the directory.
 */

/** Beyond this, two rows are not the same building however alike the names. */
export const SAME_PLACE_METRE = 150;

/** Case and spacing variants: "SinePop"/"Sinepop", "a.bodespace"/"A. Bodespace". */
export const NAME_VARIANT_THRESHOLD = 0.9;

/**
 * Below this, two co-located rows are not even worth a person looking at.
 *
 * Venues cluster: a mall or a bar strip puts a dozen unrelated rows
 * within 150m of each other. Distance alone flagged 60 pairs, nearly all
 * of them noise like "Kampai" against "Ono Kai".
 */
export const REVIEW_THRESHOLD = 0.6;

export interface VenueRow {
  venueId: number;
  name: string;
  alias: string[] | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Metres between two rows, or null when either lacks a coordinate.
 *
 * Equirectangular rather than haversine: over the few hundred metres
 * that matter here the difference is centimetres.
 */
export function metreApart(a: VenueRow, b: VenueRow): number | null {
  if (a.lat === null || a.lng === null || b.lat === null || b.lng === null) return null;
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.round(Math.sqrt(dLat * dLat + dLng * dLng));
}

/**
 * The venue with any trailing address dropped.
 *
 * Extraction frequently returns the place with its location appended:
 * "47 East, Esteban Abada, Katipunan", "The Fountain, Okada Manila".
 * The part before the first comma is the venue; the rest is where it is.
 */
export function venueHead(name: string): string {
  return normalizeVenueName(name.split(',')[0]);
}

const ALL_CAP = /^[^a-z]+$/;
const ALL_LOWER = /^[^A-Z]+$/;
const HANDLE_ISH = /^[a-z0-9._]+$/;

/**
 * Trailing words that say where a venue is, not what it is called.
 *
 * "47 East Katipunan" and "Funroof Poblacion" are the venue plus the
 * district everyone appends when giving directions. Without this the
 * longer name wins and the directory fills up with addresses.
 */
const LOCATION_SUFFIX = [
  'katipunan', 'poblacion', 'bridgetowne', 'cubao', 'ortigas', 'salcedo', 'legazpi',
  'bgc', 'taft', 'maginhawa', 'escolta', 'malate', 'tondo', 'alabang',
  'makati', 'manila', 'pasig', 'taguig', 'mandaluyong', 'san juan', 'quezon city',
  'metro manila', 'filinvest city', 'city',
  'st', 'street', 'ave', 'avenue', 'road', 'rd', 'blvd',
];

function hasLocationSuffix(name: string): boolean {
  const normal = normalizeVenueName(name);
  return LOCATION_SUFFIX.some(suffix => normal.endsWith(` ${suffix}`));
}

/** A normalised name with any trailing district or street words removed. */
export function stripLocationSuffix(normalName: string): string {
  let name = normalName;
  // Repeated because they stack: "47 east esteban abada street katipunan".
  for (let pass = 0; pass < 4; pass++) {
    const suffix = LOCATION_SUFFIX.find(candidate => name.endsWith(` ${candidate}`));
    if (!suffix) break;
    name = name.slice(0, -(suffix.length + 1)).trim();
  }
  return name;
}

/**
 * Words naming a space inside a venue rather than the venue.
 *
 * A mall and its activity center are one coordinate and nearly one name,
 * so every rule below happily folds them together — and the merge then
 * renames the mall after one of its rooms. "Ayala Malls Circuit" became
 * "Ayala Malls Circuit Activity Center" on the first dry run, which is
 * the same mistake the extraction prompt warns about from the other end.
 */
const SUB_VENUE_MARKER = [
  'activity center', 'activity park', 'atrium', 'lobby', 'concourse',
  'podium', 'ballroom', 'function room', 'retail row', 'rooftop', 'basement',
];

function subVenueMarker(name: string): string | null {
  const normal = normalizeVenueName(name);
  return SUB_VENUE_MARKER.find(marker => normal.includes(marker)) ?? null;
}

export type MergeVerdict = 'same' | 'review' | 'different';

/**
 * Are these two rows the same place?
 *
 * `review` is returned rather than `same` for pairs that are co-located
 * and similarly named but not demonstrably identical — a tenant inside a
 * larger venue reads exactly like a spelling variant from here.
 * "Greyhound Cafe, Ayala Triangle Gardens" sits inside "Ayala Triangle
 * Gardens", and folding one into the other silently drops the more
 * precise label.
 */
export function classifyPair(a: VenueRow, b: VenueRow): MergeVerdict {
  const verdict = classifyByName(a, b);

  // A venue and a room inside it are not the same row, however alike the
  // names and however close the coordinates. This only ever downgrades a
  // match: applied as its own early return it turned every unrelated
  // neighbour into a review line, 906 of them.
  if (verdict === 'same' && subVenueMarker(a.name) !== subVenueMarker(b.name)) return 'review';

  return verdict;
}

function classifyByName(a: VenueRow, b: VenueRow): MergeVerdict {
  const distance = metreApart(a, b);

  // Two rows with the same name at opposite ends of the metro are two
  // places. "Homebase" in Tondo and "HOMEBASE" in Makati are 9km apart.
  if (distance !== null && distance > SAME_PLACE_METRE) return 'different';

  const normalA = normalizeVenueName(a.name);
  const normalB = normalizeVenueName(b.name);
  if (normalA === normalB) return 'same';

  // Co-location is required for everything below: without a shared
  // coordinate a name alone is not enough to delete a row over.
  if (distance === null) return 'different';

  // Spacing is not meaning: "a.bodespace", "a bode space" and "A. Bodespace"
  // are one venue typed three ways.
  if (normalA.replace(/\s/g, '') === normalB.replace(/\s/g, '')) return 'same';

  // Similarity is only trusted between names of comparable length. One
  // name containing another scores high — "World Trade Center Metro
  // Manila and SMX Convention Center Manila" against "SMX Convention
  // Center Manila" — and those are two buildings, not two spellings.
  const lengthRatio = Math.min(normalA.length, normalB.length)
    / Math.max(normalA.length, normalB.length);
  if (lengthRatio >= 0.8 && titleSimilarity(normalA, normalB) >= NAME_VARIANT_THRESHOLD) {
    return 'same';
  }

  // "47 East" and "47 East, Esteban Abada, Katipunan" — the same venue,
  // one carrying its address. The heads must match, so "Greyhound Cafe,
  // Ayala Triangle Gardens" does not fold into "Ayala Triangle Gardens".
  if (venueHead(a.name) === venueHead(b.name)) return 'same';

  // The same, without the comma: "47 East" and "47 East Katipunan".
  if (stripLocationSuffix(normalA) === stripLocationSuffix(normalB)) return 'same';

  // Everything left is co-located, which in a mall or a bar strip means
  // almost nothing: "Kampai" and "Ono Kai" are 94m apart and unrelated.
  // Only pairs whose names actually overlap are worth a person's time.
  const tightA = normalA.replace(/\s/g, '');
  const tightB = normalB.replace(/\s/g, '');
  const isRelated = tightA.includes(tightB) || tightB.includes(tightA)
    || titleSimilarity(normalA, normalB) >= REVIEW_THRESHOLD;

  return isRelated ? 'review' : 'different';
}

/**
 * How presentable a name is on a map pin. Higher wins.
 *
 * This chooses what the public sees, so it prefers the form a person
 * would have typed: mixed case, no address trailing behind a comma, no
 * handle.
 */
export function nameScore(name: string): number {
  const trimmed = name.trim();
  let score = 0;

  if (!ALL_CAP.test(trimmed) && !ALL_LOWER.test(trimmed)) score += 4;
  if (!trimmed.includes(',')) score += 3;
  if (!HANDLE_ISH.test(trimmed)) score += 2;
  if (hasLocationSuffix(trimmed)) score -= 3;
  // "A.bode Space" against "A. Bodespace": a full stop wedged against a
  // letter is a typo of a name, not a rendering of one.
  if (/\.\S/.test(trimmed)) score -= 1;

  return score;
}

/**
 * The name the surviving row should carry.
 *
 * Length breaks ties in favour of the longer name, because once the
 * address and district forms are scored down what remains is a choice
 * between a complete name and a truncated one: "A. Bodespace" over
 * "A.bode", "Unilab Bayanihan Center" over "Bayanihan Center".
 */
export function bestName(rowList: VenueRow[]): string {
  return [...rowList].sort((a, b) => {
    const delta = nameScore(b.name) - nameScore(a.name);
    if (delta !== 0) return delta;
    if (a.name.length !== b.name.length) return b.name.length - a.name.length;
    return a.venueId - b.venueId;
  })[0].name;
}
