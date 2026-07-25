/**
 * Coordinate maths — portable, so both this repo and tripi can hold the same opinion about
 * what "the same place" means.
 *
 * ## Why this is in core rather than the web app
 *
 * `app/web/src/util/markerUtils.ts` carried a private haversine plus a proximity clusterer,
 * in a module that also imports Leaflet and a PNG. Nothing outside the browser could reach
 * either one, so the API's dedup script grew its own distance check and tripi has a third.
 * Three implementations of one formula is three places for a radius to disagree.
 *
 * Everything here is pure: no DOM, no Leaflet, no database, no clock. That is the whole
 * point -- `package/core` is the tree tripi can vendor or copy without dragging in Express,
 * Drizzle, or React. See docs/TRIPI.md.
 */

/**
 * A point on the earth.
 *
 * `latitude`/`longitude` spelled out rather than `lat`/`lng` because this is the name the
 * wire contract uses (tripi's `place.latitude`, `place.longitude`), and a type that renames
 * its fields on the way through is a type that invites a mapping bug. The database columns
 * on this side are still `lat`/`lng`; `toCoordinate` is the one place that bridges them.
 */
export interface Coordinate {
  latitude: number;
  longitude: number;
}

/** Mean earth radius in metres (IUGG). */
const EARTH_RADIUS_METER = 6_371_008.8;

const DEGREE_TO_RADIAN = Math.PI / 180;

/**
 * Great-circle distance in metres between two points.
 *
 * Haversine, not Vincenty: at Metro Manila scale the error is centimetres, and the events
 * this groups are metres apart at best. Accuracy is not the binding constraint here.
 */
export function haversineMeter(from: Coordinate, to: Coordinate): number {
  const latitudeRadian = from.latitude * DEGREE_TO_RADIAN;
  const toLatitudeRadian = to.latitude * DEGREE_TO_RADIAN;
  const latitudeDelta = (to.latitude - from.latitude) * DEGREE_TO_RADIAN;
  const longitudeDelta = (to.longitude - from.longitude) * DEGREE_TO_RADIAN;

  const chord =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeRadian) * Math.cos(toLatitudeRadian) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_METER * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord));
}

/**
 * Coerce a loosely-typed pair into a `Coordinate`, or `null` when it is not usable.
 *
 * Both feeds into this are untrustworthy in the same way: Postgres `real` columns arrive as
 * numbers, an HTTP query string arrives as text, and a missing geocode arrives as null. The
 * bound check rejects a transposed lat/lng pair, which is the failure that puts a Manila
 * event in the Indian Ocean rather than merely misplacing it by a block.
 */
export function toCoordinate(
  latitude: number | string | null | undefined,
  longitude: number | string | null | undefined,
): Coordinate | null {
  const parsedLatitude = typeof latitude === 'number' ? latitude : Number.parseFloat(latitude ?? '');
  const parsedLongitude = typeof longitude === 'number' ? longitude : Number.parseFloat(longitude ?? '');

  if (!Number.isFinite(parsedLatitude) || Math.abs(parsedLatitude) > 90) return null;
  if (!Number.isFinite(parsedLongitude) || Math.abs(parsedLongitude) > 180) return null;
  // 0,0 is in the Gulf of Guinea. As a Metro Manila coordinate it is always a default that
  // escaped rather than a real fix, and it plots a marker 6,000 km off the map.
  if (parsedLatitude === 0 && parsedLongitude === 0) return null;

  return { latitude: parsedLatitude, longitude: parsedLongitude };
}

/**
 * One group of items sitting within the clustering radius of each other.
 *
 * There is deliberately **no** `memberCount`. A count stored beside the array it counts is a
 * count that drifts from it; `member.length` cannot.
 */
export interface ProximityCluster<T> {
  /** Running mean of the members, for display. NOT the membership test -- see below. */
  latitude: number;
  longitude: number;
  member: T[];
}

/**
 * Group items by proximity, greedily, nearest-anchor-wins.
 *
 * ## Membership is tested against an anchor, not against the centroid
 *
 * Each cluster keeps the position of its **first** member as a fixed anchor, and every later
 * candidate is measured against that anchor. The mean position is maintained separately, purely
 * for drawing.
 *
 * Doing it the obvious way instead -- testing against a centroid that moves as members join --
 * has three problems, and the map shipped with all of them:
 *
 * 1. The centroid was recomputed with a full reduce over every member on each insertion, so an
 *    O(k) walk sat inside an already O(n²) loop.
 * 2. A cluster could drift away from its founding point and then swallow items that were never
 *    within the radius of anything in it.
 * 3. Because of (2) the output depended on the order the API happened to return rows in, so the
 *    same data could draw different pins.
 *
 * With a fixed anchor the result is order-independent for any input whose clusters do not
 * overlap. It is still a greedy single pass, so it is a drawing aid and **not** an identity
 * test: do not repurpose it to decide whether two catalog rows are the same place. tripi keys
 * that on `(name, area)` instead, deliberately.
 *
 * @param item        Items to group.
 * @param at          Where each item is, or null to leave it out entirely.
 * @param radiusMeter Items within this distance of a cluster's anchor join it.
 */
export function groupByProximity<T>(
  item: readonly T[],
  at: (candidate: T) => Coordinate | null,
  radiusMeter: number,
): ProximityCluster<T>[] {
  const cluster: ProximityCluster<T>[] = [];
  // Parallel to `cluster` by index. The anchor decides membership; the sums drive the mean.
  const anchor: { point: Coordinate; latitudeSum: number; longitudeSum: number }[] = [];

  for (const candidate of item) {
    const point = at(candidate);
    if (point === null) continue;

    let nearestAt = -1;
    let nearestMeter = Infinity;

    for (let index = 0; index < anchor.length; index += 1) {
      const meter = haversineMeter(anchor[index]!.point, point);
      if (meter <= radiusMeter && meter < nearestMeter) {
        nearestMeter = meter;
        nearestAt = index;
      }
    }

    if (nearestAt === -1) {
      anchor.push({ point, latitudeSum: point.latitude, longitudeSum: point.longitude });
      cluster.push({ latitude: point.latitude, longitude: point.longitude, member: [candidate] });
      continue;
    }

    const joined = anchor[nearestAt]!;
    const group = cluster[nearestAt]!;
    group.member.push(candidate);
    // Running mean, so no re-reduce over the whole membership.
    joined.latitudeSum += point.latitude;
    joined.longitudeSum += point.longitude;
    group.latitude = joined.latitudeSum / group.member.length;
    group.longitude = joined.longitudeSum / group.member.length;
  }

  return cluster;
}
