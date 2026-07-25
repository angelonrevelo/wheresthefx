import { describe, expect, it } from 'vitest';
import { groupByProximity, haversineMeter, toCoordinate, type Coordinate } from './geo.js';

/** Two Makati landmarks about 1.05 km apart. */
const SALCEDO: Coordinate = { latitude: 14.5609, longitude: 121.0224 };
const LEGAZPI: Coordinate = { latitude: 14.5537, longitude: 121.0146 };

describe('haversineMeter', () => {
  it('is zero for a point against itself', () => {
    expect(haversineMeter(SALCEDO, SALCEDO)).toBe(0);
  });

  it('measures a known Makati pair to within a few metres', () => {
    expect(haversineMeter(SALCEDO, LEGAZPI)).toBeCloseTo(1148, -2);
  });

  it('is symmetric', () => {
    expect(haversineMeter(SALCEDO, LEGAZPI)).toBeCloseTo(haversineMeter(LEGAZPI, SALCEDO), 6);
  });
});

describe('toCoordinate', () => {
  it('accepts numbers and numeric strings alike', () => {
    // Postgres `real` arrives as a number, an HTTP query string arrives as text.
    expect(toCoordinate(14.5609, 121.0224)).toEqual(SALCEDO);
    expect(toCoordinate('14.5609', '121.0224')).toEqual(SALCEDO);
  });

  it('rejects a missing coordinate', () => {
    expect(toCoordinate(null, 121.0224)).toBeNull();
    expect(toCoordinate(14.5609, undefined)).toBeNull();
    expect(toCoordinate('', '')).toBeNull();
  });

  it('rejects an out-of-range value', () => {
    expect(toCoordinate(91, 121)).toBeNull();
    expect(toCoordinate(14, 181)).toBeNull();
  });

  it('rejects 0,0', () => {
    // In the Gulf of Guinea. As a Manila coordinate it is always an escaped default.
    expect(toCoordinate(0, 0)).toBeNull();
  });
});

describe('groupByProximity', () => {
  const at = (point: Coordinate) => point;

  it('leaves distant points in their own clusters', () => {
    const cluster = groupByProximity([SALCEDO, LEGAZPI], at, 50);
    expect(cluster).toHaveLength(2);
  });

  it('merges points inside the radius', () => {
    const nearby = { latitude: SALCEDO.latitude + 0.0001, longitude: SALCEDO.longitude };
    const cluster = groupByProximity([SALCEDO, nearby], at, 50);
    expect(cluster).toHaveLength(1);
    expect(cluster[0]!.member).toHaveLength(2);
  });

  it('respects a tighter radius', () => {
    const point = [SALCEDO, { latitude: SALCEDO.latitude + 0.0003, longitude: SALCEDO.longitude }];
    expect(groupByProximity(point, at, 50)).toHaveLength(1);
    expect(groupByProximity(point, at, 20)).toHaveLength(2);
  });

  it('places a cluster at the mean of its members', () => {
    const nearby = { latitude: 14.5611, longitude: 121.0224 };
    const [cluster] = groupByProximity([SALCEDO, nearby], at, 100);
    expect(cluster!.latitude).toBeCloseTo((14.5609 + 14.5611) / 2, 6);
  });

  it('is order-independent, because membership tests against a fixed anchor', () => {
    // The centroid-based version this replaced could drift far enough to swallow a point that
    // was never within the radius of anything, so reversing the input changed the pins.
    const point = [
      SALCEDO,
      { latitude: SALCEDO.latitude + 0.0004, longitude: SALCEDO.longitude },
      { latitude: SALCEDO.latitude + 0.0008, longitude: SALCEDO.longitude },
      LEGAZPI,
    ];
    const forward = groupByProximity(point, at, 50);
    const reversed = groupByProximity([...point].reverse(), at, 50);
    expect(reversed).toHaveLength(forward.length);
  });

  it('drops items with no usable position instead of clustering them at zero', () => {
    const item = [SALCEDO, null, LEGAZPI];
    const cluster = groupByProximity(item, (one) => one, 50);
    expect(cluster).toHaveLength(2);
  });

  it('returns nothing for no input', () => {
    expect(groupByProximity([], at, 50)).toEqual([]);
  });
});
