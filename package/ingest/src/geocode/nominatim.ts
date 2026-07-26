/**
 * Venue geocoding via Nominatim (OpenStreetMap).
 *
 * Free, no key, and rate-limited to one request per second by their
 * usage policy. That policy also asks for a contact address in the
 * User-Agent so they can reach you before blocking; `GEOCODE_CONTACT`
 * supplies it, and the VPS IP is the thing at risk if it is omitted.
 *
 * The previous implementation had three faults worth not repeating:
 *
 * 1. It never recorded that a lookup had happened, so a venue that could
 *    never be resolved was retried on every run, forever, at 1.1s each.
 * 2. It set `location_status` to `confirmed` for every event it touched,
 *    destroying the `tba` / `secret` / `dm_for_details` distinction that
 *    matters to this scene.
 * 3. It was never called by the ingest, so new venues stayed unmapped
 *    until somebody remembered to run it by hand.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

/** Their policy is one request per second. This is the floor, not a target. */
const MIN_REQUEST_INTERVAL_MS = 1100;

/**
 * Metro Manila, generously bounded.
 *
 * Used to bias results, not to restrict them: a venue genuinely outside
 * the region should still resolve correctly rather than snap to a
 * same-named place in Manila, which is the worse failure.
 */
const VIEWBOX = '120.85,14.35,121.15,14.80';

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface GeocodeOutcome {
  coordinate: Coordinate | null;
  /** Why it failed, for the run log. */
  reason: string | null;
}

/**
 * Metro Manila, as a hard bound on accepted results.
 *
 * A wrong pin is worse than no pin: an absent event is merely missing,
 * whereas one placed at a guessed coordinate sends somebody to the wrong
 * address. Anything resolving outside the region the product covers is
 * rejected rather than shown.
 */
const BOUND = { minLat: 14.20, maxLat: 14.90, minLng: 120.80, maxLng: 121.25 };

function isWithinMetroManila(lat: number, lng: number): boolean {
  return lat >= BOUND.minLat && lat <= BOUND.maxLat
    && lng >= BOUND.minLng && lng <= BOUND.maxLng;
}

/**
 * Venue strings too generic to geocode safely.
 *
 * These come out of extraction when a caption gives a location without
 * naming a place — "multiple locations", "the bar", "open space". They
 * often *do* resolve, to whatever shares the name, and that result is
 * confidently wrong. Cheaper to leave the event unmapped.
 */
const TOO_GENERIC = /^(the |a )?(bar|venue|location|place|space|park|hall|studio|room|lobby|center|centre|activity (center|centre|park)|open space|multiple locations?|various locations?|tba|tbd|online|venue tba)$/i;

export function isGeocodableName(venueName: string): boolean {
  const trimmed = venueName.trim();
  // A two-character name carries no signal a geocoder can use.
  if (trimmed.length < 4) return false;
  return !TOO_GENERIC.test(trimmed);
}

let lastRequestAt = 0;

async function respectRateLimit(): Promise<void> {
  const sinceLast = Date.now() - lastRequestAt;
  if (sinceLast < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - sinceLast));
  }
  lastRequestAt = Date.now();
}

function buildUserAgent(): string {
  const contact = process.env.GEOCODE_CONTACT;
  return contact
    ? `WheresTheFX/1.0 (${contact})`
    : 'WheresTheFX/1.0 (contact not configured — set GEOCODE_CONTACT)';
}

/**
 * Resolve one venue name to coordinates.
 *
 * Returns `{ coordinate: null }` rather than throwing: a venue that
 * cannot be found is an ordinary outcome, and the caller records the
 * attempt either way so it is not repeated indefinitely.
 */
export async function geocodeVenue(
  venueName: string,
  address?: string | null,
): Promise<GeocodeOutcome> {
  if (!isGeocodableName(venueName)) {
    return { coordinate: null, reason: 'name too generic to place safely' };
  }

  const query = [venueName, address, 'Metro Manila, Philippines']
    .filter(Boolean)
    .join(', ');

  await respectRateLimit();

  try {
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'ph');
    url.searchParams.set('viewbox', VIEWBOX);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': buildUserAgent() },
    });
    clearTimeout(timeout);

    if (response.status === 429) {
      return { coordinate: null, reason: 'rate limited' };
    }
    if (!response.ok) {
      return { coordinate: null, reason: `HTTP ${response.status}` };
    }

    const resultList = await response.json() as { lat?: string; lon?: string }[];
    const first = resultList[0];
    if (!first?.lat || !first?.lon) {
      return { coordinate: null, reason: 'no match' };
    }

    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { coordinate: null, reason: 'unparseable coordinates' };
    }

    if (!isWithinMetroManila(lat, lng)) {
      return {
        coordinate: null,
        reason: `resolved outside Metro Manila (${lat.toFixed(3)},${lng.toFixed(3)})`,
      };
    }

    return { coordinate: { lat, lng }, reason: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { coordinate: null, reason: message.includes('abort') ? 'timeout' : message };
  }
}
