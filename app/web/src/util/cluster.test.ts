import { describe, expect, it } from 'vitest';
import { groupEventsByProximity, type GeoEvent } from './cluster.js';

/** ~0.0001 degrees of latitude is ~11m in Metro Manila. */
const BASE_LAT = 14.5547;
const BASE_LNG = 121.0244;

function at(lat: number, lng: number, id = ''): GeoEvent {
  return { location_lat: lat, location_lng: lng, id };
}

describe('groupEventsByProximity', () => {
  it('returns nothing for an empty list', () => {
    expect(groupEventsByProximity([])).toEqual([]);
  });

  it('keeps far-apart events in separate clusters', () => {
    const cluster = groupEventsByProximity([
      at(BASE_LAT, BASE_LNG),
      at(BASE_LAT + 0.05, BASE_LNG + 0.05), // several km away
    ]);
    expect(cluster).toHaveLength(2);
  });

  it('merges events within the radius', () => {
    const cluster = groupEventsByProximity([
      at(BASE_LAT, BASE_LNG),
      at(BASE_LAT + 0.0002, BASE_LNG), // ~22m
    ], 50);
    expect(cluster).toHaveLength(1);
    expect(cluster[0].event).toHaveLength(2);
  });

  it('respects a tighter radius', () => {
    const point = [at(BASE_LAT, BASE_LNG), at(BASE_LAT + 0.0004, BASE_LNG)]; // ~44m
    expect(groupEventsByProximity(point, 50)).toHaveLength(1);
    expect(groupEventsByProximity(point, 20)).toHaveLength(2);
  });

  it('is order-independent', () => {
    // The previous implementation moved each cluster's centroid as members
    // were added, so the same data in a different order produced different
    // markers. Membership is now decided against a fixed anchor.
    const point = [
      at(BASE_LAT, BASE_LNG, 'a'),
      at(BASE_LAT + 0.0002, BASE_LNG, 'b'),
      at(BASE_LAT + 0.0004, BASE_LNG, 'c'),
      at(BASE_LAT + 0.02, BASE_LNG, 'far'),
    ];
    const forward = groupEventsByProximity(point, 50);
    const reversed = groupEventsByProximity([...point].reverse(), 50);
    expect(reversed.length).toBe(forward.length);
  });

  it('skips events with missing or unparseable coordinates', () => {
    const cluster = groupEventsByProximity([
      at(BASE_LAT, BASE_LNG),
      { location_lat: null, location_lng: null },
      { location_lat: 'not-a-number', location_lng: '121.0' },
    ]);
    expect(cluster).toHaveLength(1);
  });

  it('accepts string coordinates, as the API returns them', () => {
    const cluster = groupEventsByProximity([
      { location_lat: String(BASE_LAT), location_lng: String(BASE_LNG) },
    ]);
    expect(cluster).toHaveLength(1);
    expect(cluster[0].lat).toBeCloseTo(BASE_LAT, 6);
  });

  it('reports the count as the member array length, with no second counter', () => {
    const cluster = groupEventsByProximity([
      at(BASE_LAT, BASE_LNG),
      at(BASE_LAT + 0.0001, BASE_LNG),
      at(BASE_LAT + 0.0002, BASE_LNG),
    ], 50);
    expect(cluster[0].event).toHaveLength(3);
  });

  it('places the marker at the mean of its members', () => {
    const cluster = groupEventsByProximity([
      at(BASE_LAT, BASE_LNG),
      at(BASE_LAT + 0.0002, BASE_LNG),
    ], 50);
    expect(cluster[0].lat).toBeCloseTo(BASE_LAT + 0.0001, 6);
  });
});
