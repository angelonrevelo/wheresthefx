import { describe, expect, it } from 'vitest';
import { CATEGORY } from './category.js';
import {
  DEFAULT_AREA_NAME,
  TRIPI_SOURCE,
  toDraftExport,
  toEventDraft,
  toPlaceDraft,
  toTripiCategoryTag,
  toTripiPriceBand,
  type EventSource,
  type VenueSource,
} from './tripi.js';

function venue(over: Partial<VenueSource> = {}): VenueSource {
  return {
    venue_id: 19,
    name: '19 East',
    address: '19th Ave, Sucat',
    city: 'Parañaque',
    lat: 14.5233,
    lng: 121.0478,
    category: 'music',
    ...over,
  };
}

function event(over: Partial<EventSource> = {}): EventSource {
  return {
    event_id: 864,
    title: 'Live Music @ 70s Bistro',
    event_date: '2026-08-15',
    event_end_date: null,
    event_time: '20:00',
    end_time: null,
    venue_name: '70s Bistro',
    venue_address: 'Anonas St, Quezon City',
    venue_lat: 14.630706,
    venue_lng: 121.06137,
    category: 'music',
    is_free: false,
    price: 350,
    price_min: null,
    price_max: null,
    confidence: 0.93,
    source_url: 'https://instagram.com/p/abc',
    ...over,
  };
}

describe('toTripiCategoryTag', () => {
  it('covers every canonical category', () => {
    // A category with no mapping would silently fall through to itself, which is a tag
    // tripi's search cannot match on. Every one of the twelve gets real words.
    for (const category of CATEGORY) {
      expect(toTripiCategoryTag(category).length).toBeGreaterThan(0);
    }
  });

  it('emits lowercase, deduped tags', () => {
    const tag = toTripiCategoryTag('workshops', ['Workshop', 'CLASS', 'class']);
    expect(tag).toEqual(tag.map((one) => one.toLowerCase()));
    expect(new Set(tag).size).toBe(tag.length);
  });

  it('caps at the eight tripi is willing to store', () => {
    const extra = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    expect(toTripiCategoryTag('music', extra)).toHaveLength(8);
  });

  it('falls back to the raw value for a category it does not know', () => {
    expect(toTripiCategoryTag('art_culture')).toEqual(['art_culture']);
  });

  it('returns nothing for a null category rather than inventing a tag', () => {
    expect(toTripiCategoryTag(null)).toEqual([]);
  });
});

describe('toTripiPriceBand', () => {
  it('puts free in band 1, not band 0', () => {
    // tripi's CHECK is BETWEEN 1 AND 3; a 0 would be rejected by the database.
    expect(toTripiPriceBand({ is_free: true })).toBe(1);
  });

  it('bands a gig door charge, a ticketed show, and a festival', () => {
    expect(toTripiPriceBand({ price: 350 })).toBe(1);
    expect(toTripiPriceBand({ price: 1200 })).toBe(2);
    expect(toTripiPriceBand({ price: 4500 })).toBe(3);
  });

  it('stays null when nothing was extracted', () => {
    // Guessing "cheap" is the one error that costs a student money.
    expect(toTripiPriceBand({})).toBeNull();
    expect(toTripiPriceBand({ price: null, price_min: null, price_max: null })).toBeNull();
  });

  it('falls back to price_min then price_max', () => {
    expect(toTripiPriceBand({ price_min: 900 })).toBe(2);
    expect(toTripiPriceBand({ price_max: 2000 })).toBe(3);
  });

  it('ignores a negative price', () => {
    expect(toTripiPriceBand({ price: -1 })).toBeNull();
  });
});

describe('toPlaceDraft', () => {
  it('produces a draft tripi can insert without translation', () => {
    const draft = toPlaceDraft(venue());
    expect(draft.source).toBe(TRIPI_SOURCE);
    expect(draft.name).toBe('19 East');
    expect(draft.area_name).toBe('Parañaque');
    expect(draft.latitude).toBe(14.5233);
    expect(draft.external_ref).toBe('venue/19');
    expect(draft.skip_reason).toBeNull();
  });

  it('falls back to the Metro Manila area rather than leaving it null', () => {
    // A null area_name collapses every unplaced venue into one dedupe bucket, because
    // tripi keys the catalog on (lower(name), lower(coalesce(area_name, ''))).
    expect(toPlaceDraft(venue({ city: null })).area_name).toBe(DEFAULT_AREA_NAME);
  });

  it('claims no confidence it does not have', () => {
    expect(toPlaceDraft(venue()).confidence).toBeNull();
  });

  it('skips a nameless venue but still returns it with a reason', () => {
    const draft = toPlaceDraft(venue({ name: '   ' }));
    expect(draft.skip_reason).toBe('no name');
    expect(draft.external_ref).toBe('venue/19');
  });

  it('skips an ungeocoded venue', () => {
    expect(toPlaceDraft(venue({ lat: null })).skip_reason).toBe('no coordinate');
  });

  it('rejects an out-of-range coordinate instead of passing it to tripi', () => {
    // tripi has a CHECK on both ranges; sending 999 would fail the whole insert batch.
    expect(toPlaceDraft(venue({ lat: 999 })).skip_reason).toBe('no coordinate');
  });
});

describe('toEventDraft', () => {
  it('names the place after the venue, not the event', () => {
    // Otherwise every night at the same bar mints another catalog row.
    const draft = toEventDraft(event());
    expect(draft.name).toBe('70s Bistro');
    expect(draft.title).toBe('Live Music @ 70s Bistro');
  });

  it('carries the date, time, and band a day-picker needs', () => {
    const draft = toEventDraft(event());
    expect(draft.event_date).toBe('2026-08-15');
    expect(draft.start_time).toBe('20:00');
    expect(draft.price_band).toBe(1);
    expect(draft.is_free).toBe(false);
    expect(draft.external_ref).toBe('event/864');
  });

  it('passes extractor confidence through', () => {
    expect(toEventDraft(event()).confidence).toBe(0.93);
  });

  it('drops a confidence outside 0..1', () => {
    expect(toEventDraft(event({ confidence: 42 })).confidence).toBeNull();
  });

  it('reports a missing date first, because that is what makes it useless', () => {
    const draft = toEventDraft(event({ event_date: null, title: null }));
    expect(draft.skip_reason).toBe('no date');
  });

  it('rejects a malformed date rather than forwarding it', () => {
    expect(toEventDraft(event({ event_date: 'next friday' })).skip_reason).toBe('no date');
  });

  it('normalises a single-digit hour and drops a nonsense one', () => {
    expect(toEventDraft(event({ event_time: '9:30' })).start_time).toBe('09:30');
    expect(toEventDraft(event({ event_time: '99:99' })).start_time).toBeNull();
    expect(toEventDraft(event({ event_time: 'doors at 9' })).start_time).toBeNull();
  });
});

describe('toDraftExport', () => {
  it('splits skipped records out of the payload but keeps their reason', () => {
    const at = new Date('2026-07-26T02:00:00Z');
    const result = toDraftExport(
      [toPlaceDraft(venue()), toPlaceDraft(venue({ venue_id: 20, name: null }))],
      at,
    );

    expect(result.draft_count).toBe(1);
    expect(result.draft).toHaveLength(1);
    expect(result.skipped).toEqual([{ external_ref: 'venue/20', skip_reason: 'no name' }]);
    expect(result.exported_at).toBe('2026-07-26T02:00:00.000Z');
    expect(result.version).toBe(1);
  });

  it('keeps draft_count honest against the array it ships', () => {
    const result = toDraftExport([toPlaceDraft(venue())], new Date(0));
    expect(result.draft_count).toBe(result.draft.length);
  });
});
