import { describe, expect, it } from 'vitest';
import { isGeocodableName } from './nominatim.js';

/**
 * The asymmetry here is the opposite of the extraction pre-filter's.
 *
 * There, rejecting was expensive because a missed event is gone. Here,
 * *accepting* is expensive: a generic name like "Activity Center" will
 * happily resolve to whatever shares it, and 14 events then appear at a
 * confidently wrong address. An unmapped event is merely absent; a
 * mislocated one sends somebody to the wrong place.
 *
 * All of the rejected names below came out of a real extraction run.
 */

describe('isGeocodableName', () => {
  const realVenue = [
    "Mow's Bar",
    '19 East',
    'SM Mall of Asia Arena',
    'Ayala Triangle Gardens',
    'New Frontier Theater',
    'Artinformal Gallery',
    'Quantum Skyview, UGB',
    'Philippine Arena',
  ];

  for (const name of realVenue) {
    it(`accepts a real venue: ${name}`, () => {
      expect(isGeocodableName(name)).toBe(true);
    });
  }

  const genericName = [
    'the bar',
    'Multiple Locations',
    'Open Space',
    'Activity Park',
    'Activity Center',
    'Various Locations',
    'TBA',
    'venue',
    'Online',
  ];

  for (const name of genericName) {
    it(`rejects a name too generic to place: ${name}`, () => {
      expect(isGeocodableName(name)).toBe(false);
    });
  }

  it('rejects anything too short to carry signal', () => {
    expect(isGeocodableName('')).toBe(false);
    expect(isGeocodableName('AB')).toBe(false);
    expect(isGeocodableName('  x ')).toBe(false);
  });

  it('does not reject a real venue that merely contains a generic word', () => {
    // The pattern is anchored, so only the whole string counts.
    expect(isGeocodableName('Glorietta Activity Center')).toBe(true);
    expect(isGeocodableName('Bonifacio Global City Open Space')).toBe(true);
    expect(isGeocodableName('The Bar at Raffles')).toBe(true);
  });
});
