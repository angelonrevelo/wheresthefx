/**
 * Map marker clustering.
 *
 * Deliberately free of any Leaflet import: this is pure geometry, and
 * keeping it that way means it can be unit-tested without a DOM. The
 * Leaflet-dependent icon builder lives in `markerIcon.ts`.
 *
 * The geometry itself now comes from `@wheresthefx/core`, which is the tree the API and tripi
 * also read. It used to live in `markerUtils.ts`, which imported Leaflet and a PNG, so nothing
 * outside the browser could reach it and the API's dedup script grew a second copy of the same
 * haversine. One formula, one radius, one place to fix it. See docs/TRIPI.md.
 *
 * What stays here is the adapter: the knowledge that a map event carries
 * `location_lat`/`location_lng` (the intermediate shape `useEventMarkers` builds out of the
 * API's `venue_lat`/`venue_lng`) rather than a `Coordinate`.
 */

import { groupByProximity, toCoordinate } from "@wheresthefx/core";

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
 * Membership is decided against each cluster's founding position rather than a moving centroid,
 * so the output does not depend on the order the API happened to return rows in. That reasoning,
 * and the three bugs the original had, are documented on `groupByProximity` in
 * `package/core/src/geo.ts`.
 *
 * `toCoordinate` also tightens the coordinate guard on the way past: the check here was
 * finiteness-only, so it accepted a transposed pair and a stray `0,0` default and plotted both.
 */
export function groupEventsByProximity(
  eventList: GeoEvent[],
  radiusMeter: number = 50,
): LocationMarker[] {
  return groupByProximity(
    eventList,
    (one) => toCoordinate(one.location_lat, one.location_lng),
    radiusMeter,
  ).map((one) => ({
    lat: one.latitude,
    lng: one.longitude,
    event: one.member,
  }));
}
