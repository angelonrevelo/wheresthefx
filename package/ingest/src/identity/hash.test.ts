import { describe, expect, it } from 'vitest';
import {
  assignReviewTier,
  completenessScore,
  eventHash,
  titleSimilarity,
} from './hash.js';

describe('eventHash', () => {
  it('is deterministic', () => {
    expect(eventHash('Jazz Night', '2026-08-15', "Mow's Bar"))
      .toBe(eventHash('Jazz Night', '2026-08-15', "Mow's Bar"));
  });

  it('is 32 hex chars', () => {
    expect(eventHash('X', '2026-08-15', 'Y')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('collapses the same gig posted three different ways', () => {
    // The venue, the promoter, and the headliner all title it differently.
    const canonical = eventHash('Men I Trust', '2026-08-15', 'SMX');
    expect(eventHash('Karpos Live presents: Men I Trust', '2026-08-15', 'SMX')).toBe(canonical);
    expect(eventHash('Men I Trust at SMX', '2026-08-15', 'SMX')).toBe(canonical);
    expect(eventHash('MEN I TRUST 2026', '2026-08-15', 'SMX')).toBe(canonical);
    expect(eventHash("Men I Trust", '2026-08-15', 'SMX')).toBe(canonical);
  });

  it('ignores punctuation and case', () => {
    expect(eventHash("Mow's Jazz", '2026-08-15', 'Bar'))
      .toBe(eventHash('MOWS JAZZ', '2026-08-15', 'bar'));
  });

  it('strips generic event-word suffixes', () => {
    const base = eventHash('Planet Groove', '2026-08-15', 'Bar');
    expect(eventHash('Planet Groove Night', '2026-08-15', 'Bar')).toBe(base);
    expect(eventHash('Planet Groove Party', '2026-08-15', 'Bar')).toBe(base);
  });

  it('separates genuinely different events', () => {
    const a = eventHash('Jazz Night', '2026-08-15', 'Bar A');
    expect(eventHash('Rock Night', '2026-08-15', 'Bar A')).not.toBe(a);
    expect(eventHash('Jazz Night', '2026-08-16', 'Bar A')).not.toBe(a);
    expect(eventHash('Jazz Night', '2026-08-15', 'Bar B')).not.toBe(a);
  });


  it('treats a smart apostrophe as a straight one', () => {
    // Instagram captions use U+2019 constantly. The character class here
    // originally held only U+0027 while appearing to cover both, so the
    // same event written two ways produced two hashes and two rows.
    expect(eventHash('Mow’s Jazz', '2026-08-15', 'Bar'))
      .toBe(eventHash("Mow's Jazz", '2026-08-15', 'Bar'));
    expect(eventHash('Gig', '2026-08-15', 'Mow’s Bar'))
      .toBe(eventHash('Gig', '2026-08-15', "Mow's Bar"));
  });

  it('handles a missing venue without throwing', () => {
    expect(eventHash('Secret Party', '2026-08-15', null)).toMatch(/^[0-9a-f]{32}$/);
    expect(eventHash('Secret Party', '2026-08-15', null))
      .toBe(eventHash('Secret Party', '2026-08-15', undefined));
  });
});

describe('titleSimilarity', () => {
  it('scores identical titles 1', () => {
    expect(titleSimilarity('Jazz Night', 'Jazz Night')).toBe(1);
    expect(titleSimilarity('Jazz Night', 'JAZZ NIGHT!')).toBe(1);
  });

  it('scores containment high', () => {
    expect(titleSimilarity('Men I Trust', 'Men I Trust Asia Tour')).toBeGreaterThanOrEqual(0.85);
  });

  it('scores unrelated titles low', () => {
    expect(titleSimilarity('Jazz Night', 'Salcedo Weekend Market')).toBeLessThan(0.3);
  });

  it('handles empty input without throwing', () => {
    expect(titleSimilarity('', 'Jazz Night')).toBe(0);
    expect(titleSimilarity('', '')).toBe(1);
  });

  it('does not over-score a short string inside a long one', () => {
    // Guarded on length, so "a" inside "art fair" is not 0.9.
    expect(titleSimilarity('a', 'art fair')).toBeLessThan(0.9);
  });

  it('treats & and "and" as the same word', () => {
    // One promoter writes "Bo Razon & Friends", another writes
    // "Bo Razon and Friends", for the same gig on the same night.
    expect(titleSimilarity('Bo Razon & Friends Live at 19 East', 'Bo Razon and Friends at 19 East'))
      .toBeGreaterThanOrEqual(0.75);
  });

  it('scores the real near-duplicates above the merge threshold', () => {
    // Both observed in a live scrape of the same account.
    expect(titleSimilarity(
      'PORKLABANAN: National Hog Festival 2026',
      'Porklabanan: National Hog Fest',
    )).toBeGreaterThanOrEqual(0.75);
  });

  it('keeps genuinely different events below it', () => {
    // These share a venue and a date in practice, so only the title
    // separates them. A false merge here deletes one from the map.
    for (const [a, b] of [
      ['Jazz Night', 'Rock Night'],
      ['Freestyle at 19 East', 'Upcoming Gigs at 19 East'],
      ['Open Mic Night', 'Comedy Night'],
      ['Salcedo Saturday Market', 'Legazpi Sunday Market'],
    ] as const) {
      expect(titleSimilarity(a, b), `${a} / ${b}`).toBeLessThan(0.75);
    }
  });

  it('is symmetric', () => {
    const a = titleSimilarity('Jazz Night Live', 'Jazz Night');
    const b = titleSimilarity('Jazz Night', 'Jazz Night Live');
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('completenessScore', () => {
  it('scores an empty event 0', () => {
    expect(completenessScore({})).toBe(0);
  });

  it('scores a fully populated event 1', () => {
    expect(completenessScore({
      title: 'Jazz Night',
      eventDate: '2026-08-15',
      eventTime: '21:00',
      venueName: "Mow's Bar",
      price: 500,
      signupUrl: 'https://x.com',
      imageUrl: 'https://y.com/a.jpg',
      description: 'A night of jazz',
      category: 'music',
      artist: ['Some Band'],
    })).toBe(1);
  });

  it('counts isFree when there is no price', () => {
    // A free event is fully priced information, not missing information.
    expect(completenessScore({ isFree: true })).toBe(0.10);
    expect(completenessScore({ price: 500 })).toBe(0.10);
    expect(completenessScore({ price: 500, isFree: false })).toBe(0.10);
  });

  it('ranks a richer record above a sparser one', () => {
    const sparse = completenessScore({ title: 'Gig', eventDate: '2026-08-15' });
    const rich = completenessScore({
      title: 'Gig', eventDate: '2026-08-15', venueName: 'Bar', eventTime: '21:00',
    });
    expect(rich).toBeGreaterThan(sparse);
  });

  it('ignores an empty artist array', () => {
    expect(completenessScore({ artist: [] })).toBe(0);
  });
});

describe('assignReviewTier', () => {
  const complete = {
    title: 'Jazz Night',
    eventDate: '2026-08-15',
    venueName: "Mow's Bar",
    eventTime: '21:00',
  };

  it('rejects anything below 0.4 confidence', () => {
    expect(assignReviewTier(0.39, complete)).toBe('rejected');
    expect(assignReviewTier(0, complete)).toBe('rejected');
  });

  it('marks high-confidence complete events ready', () => {
    expect(assignReviewTier(0.9, complete)).toBe('ready');
  });

  it('will not mark an incomplete event ready however confident', () => {
    // Confidence in a reading is not the same as having the fields.
    expect(assignReviewTier(0.99, { title: 'Gig', eventDate: '2026-08-15' })).toBe('quick');
  });

  it('marks mid-confidence events for quick review', () => {
    expect(assignReviewTier(0.7, { title: 'Gig', eventDate: '2026-08-15' })).toBe('quick');
  });

  it('sends the rest to full review', () => {
    expect(assignReviewTier(0.5, { title: 'Gig' })).toBe('full');
    expect(assignReviewTier(0.5, complete)).toBe('full');
  });
});

describe('titleSimilarity — the trailing venue is not part of the title', () => {
  it('scores two different venues as identical titles, by design', () => {
    // "Souk Popup at Estancia" and "Souk Popup at Rizal Row" both
    // normalise to "souk popup" and score 1.00, which reads like a bug
    // and is not one. The venue is stripped here on purpose so "Jazz
    // Night at Mow's" matches "Jazz Night"; keeping the two apart is
    // `isSameEvent`'s job, and it requires the venues to agree.
    expect(titleSimilarity('Souk Popup at Estancia', 'Souk Popup at Rizal Row')).toBe(1);
    expect(titleSimilarity('Jazz Night at Mow\u2019s Bar', 'Jazz Night')).toBe(1);
  });

  it('strips a presenter prefix for the same reason', () => {
    expect(titleSimilarity('Karpos Live presents Hiatus Kaiyote', 'Hiatus Kaiyote')).toBe(1);
  });
});
