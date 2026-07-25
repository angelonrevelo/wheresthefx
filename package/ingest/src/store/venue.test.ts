import { describe, expect, it } from 'vitest';
import { VenueIndex, normalizeVenueName } from './venue.js';

describe('normalizeVenueName', () => {
  it('folds case, punctuation and spacing', () => {
    expect(normalizeVenueName("Mow's Bar")).toBe('mows bar');
    expect(normalizeVenueName('MOWS   BAR')).toBe('mows bar');
    expect(normalizeVenueName('19 East')).toBe('19 east');
  });

  it('normalises ampersands, which venues spell both ways', () => {
    expect(normalizeVenueName('Jess & Pat\'s')).toBe(normalizeVenueName('Jess and Pats'));
  });

  it('handles smart quotes, which Instagram captions use constantly', () => {
    expect(normalizeVenueName('Mow’s Bar')).toBe(normalizeVenueName("Mow's Bar"));
  });
});

describe('VenueIndex', () => {
  const index = new VenueIndex([
    { venueId: 1, name: '19 East', alias: ['19East', '19 East Bar'], lat: 14.4, lng: 121.0 },
    { venueId: 2, name: "Mow's Bar", alias: null, lat: 14.63, lng: 121.05 },
    { venueId: 3, name: 'SM Mall of Asia Arena', alias: ['MOA Arena'], lat: 14.53, lng: 120.98 },
  ]);

  it('matches on the canonical name', () => {
    expect(index.match('19 East')?.venueId).toBe(1);
  });

  it('matches case- and punctuation-insensitively', () => {
    expect(index.match('MOWS BAR')?.venueId).toBe(2);
    expect(index.match("mow's bar")?.venueId).toBe(2);
  });

  it('matches on an alias', () => {
    // This is what makes three spellings land on one map pin.
    expect(index.match('19East')?.venueId).toBe(1);
    expect(index.match('19 East Bar')?.venueId).toBe(1);
    expect(index.match('MOA Arena')?.venueId).toBe(3);
  });

  it('returns null for an unknown venue rather than guessing', () => {
    expect(index.match('Some Bar That Does Not Exist')).toBeNull();
  });

  it('does not fuzzy-match distinct venues onto each other', () => {
    // "Jazz Night at Bar A" vs "Bar B" — a wrong merge deletes an event
    // from the map, so containment matching is deliberately not done.
    expect(index.match('19 East Annex')).toBeNull();
    expect(index.match('East')).toBeNull();
  });

  it('handles null and empty input', () => {
    expect(index.match(null)).toBeNull();
    expect(index.match(undefined)).toBeNull();
    expect(index.match('')).toBeNull();
  });

  it('never lets an alias displace a real venue name', () => {
    const shadowed = new VenueIndex([
      { venueId: 1, name: 'The Bar', alias: null, lat: null, lng: null },
      { venueId: 2, name: 'Another Place', alias: ['The Bar'], lat: null, lng: null },
    ]);
    expect(shadowed.match('The Bar')?.venueId).toBe(1);
  });
});
