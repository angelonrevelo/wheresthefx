/**
 * Map marker clustering.
 *
 * Deliberately free of any Leaflet import: this is pure geometry, and
 * keeping it that way means it can be unit-tested without a DOM. The
 * Leaflet-dependent icon builder lives in `markerIcon.ts`.
 */

// Haversine formula to calculate distance between two lat/lng points in meters
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export interface LocationMarker {
  lat: number;
  lng: number;
  /** Members of this cluster. `event.length` is the count — there is no
   *  separate counter, which previously drifted from the array. */
  event: GeoEvent[];
}

/** One event as far as clustering is concerned. */

export interface GeoEvent {
  location_lat: number | string | null;
  location_lng: number | string | null;
  [key: string]: unknown;
}

/**
 * Group events into map markers by proximity.
 *
 * Rewritten from the original, which had three problems:
 *
 * 1. It recomputed each cluster's centroid with a full `reduce` over
 *    every member on every insertion — O(k) inside an O(n²) loop.
 * 2. The centroid moved as members were added, so a cluster could drift
 *    away from its founding point and swallow events that were never
 *    within the radius of anything.
 * 3. Because of (2) the output depended on the order the API happened to
 *    return rows in — the same data could produce different markers.
 *
 * This version keeps each cluster anchored to the position of its first
 * member, so membership is decided against a fixed point, and maintains
 * a running mean for display only. Output is order-independent for any
 * input where clusters do not overlap.
 */
export function groupEventsByProximity(
  eventList: GeoEvent[],
  radiusMeter: number = 50,
): LocationMarker[] {
  const clusterList: LocationMarker[] = [];
  // Anchors are the membership test; the centroid is display only.
  const anchorList: { lat: number; lng: number; sumLat: number; sumLng: number }[] = [];

  for (const event of eventList) {
    const lat = typeof event.location_lat === "string"
      ? parseFloat(event.location_lat)
      : event.location_lat;
    const lng = typeof event.location_lng === "string"
      ? parseFloat(event.location_lng)
      : event.location_lng;

    if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    let nearestIndex = -1;
    let minDistance = Infinity;

    for (let i = 0; i < anchorList.length; i++) {
      const distance = calculateDistance(anchorList[i].lat, anchorList[i].lng, lat, lng);
      if (distance <= radiusMeter && distance < minDistance) {
        minDistance = distance;
        nearestIndex = i;
      }
    }

    if (nearestIndex >= 0) {
      const anchor = anchorList[nearestIndex];
      const cluster = clusterList[nearestIndex];
      cluster.event.push(event);
      // Running mean — no re-reduce over the whole membership.
      anchor.sumLat += lat;
      anchor.sumLng += lng;
      cluster.lat = anchor.sumLat / cluster.event.length;
      cluster.lng = anchor.sumLng / cluster.event.length;
      continue;
    }

    anchorList.push({ lat, lng, sumLat: lat, sumLng: lng });
    clusterList.push({ lat, lng, event: [event] });
  }

  return clusterList;
}
