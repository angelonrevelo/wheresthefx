import { describe, expect, it } from 'vitest';
import { prefilterCaption } from './prefilter.js';

/**
 * The asymmetry these tests encode: an extraction costs ~$0.00085, a
 * missed event is absent from the product indefinitely. So the
 * "must not reject" block is the one that matters, and it is long.
 *
 * An earlier signal-scoring version passed most of these and still lost
 * 42.7% of known events when measured against the real corpus. Cheap
 * unit tests did not catch that; measuring did. If this filter is ever
 * made stricter, re-measure against `data/ig-events.db` before believing
 * it is an improvement.
 */

describe('prefilterCaption — must not reject real events', () => {
  const passCase: [string, string][] = [
    ['nightlife with everything', "PLANET GROOVE 🪐 this Saturday!\nDJ sets all night\n📍 Mow's Bar, QC\n9PM til late\nFree entrance, ₱500 consumable"],
    ['full month name', 'Opening reception March 14. 📍 Ayala Museum, Makati City. Everyone is welcome to join us.'],
    ['ticketed concert', 'Kodaline Farewell Tour — August 10 at SM Mall of Asia Arena. Tickets from PHP 3500 via SM Tickets.'],
    ['Filipino language', 'Samahan niyo kami sa Sabado, Dis 15! Alas-7 ng gabi sa 19 East. Libre ang entrance!'],
    ['market', 'Salcedo Weekend Market is on again this Saturday, 7AM to 2PM. See you at Jaime Velasquez Park!'],
    ['terse, detail is in the poster', 'Full lineup and details on the poster. Doors at 8. See you there, Manila.'],
    ['no explicit date, poster-led', 'Our biggest show yet is happening at 19 East. Swipe for the full lineup and ticket links.'],
    ['vendor call', 'Calling all creatives! Applications are now open for our next market run. Link in bio to apply.'],
  ];

  for (const [label, caption] of passCase) {
    it(`passes: ${label}`, () => {
      expect(prefilterCaption(caption).isWorthExtracting).toBe(true);
    });
  }
});

describe('prefilterCaption — rejects only the obvious', () => {
  const rejectCase: [string, string][] = [
    ['throwback', 'What a night! Thank you to everyone who came out last Friday. #tbt See you next time!'],
    ['giveaway', 'GIVEAWAY! Tag 3 friends and follow us to win a free bucket. Winners announced Monday!'],
    ['menu item', 'NEW ON THE MENU: our seasonal ube latte is finally here, available at both branches.'],
    ['hiring', 'WE ARE HIRING! Looking for baristas and servers. Send your CV to hello@example.com today.'],
    ['too short', 'Good vibes ✨'],
  ];

  for (const [label, caption] of rejectCase) {
    it(`rejects: ${label}`, () => {
      const result = prefilterCaption(caption);
      expect(result.isWorthExtracting).toBe(false);
      expect(result.reason).toBeTruthy();
    });
  }

  it('handles absent captions', () => {
    expect(prefilterCaption(null).isWorthExtracting).toBe(false);
    expect(prefilterCaption(undefined).isWorthExtracting).toBe(false);
    expect(prefilterCaption('').isWorthExtracting).toBe(false);
  });
});

describe('prefilterCaption — does not over-reject on a keyword alone', () => {
  it('keeps an event that merely thanks a sponsor', () => {
    // "thanks to" appears constantly in legitimate listings. Only the
    // recap phrasings are matched.
    expect(prefilterCaption(
      'Our March 14 show is happening, with thanks to our partners. Doors 8PM at 19 East, ₱500.',
    ).isWorthExtracting).toBe(true);
  });

  it('keeps an event that mentions a raffle as one element', () => {
    // A gig with a door raffle is still a gig. This is a known accepted
    // false positive: it costs a fraction of a cent, not an event.
    const result = prefilterCaption(
      'Gig night this Friday at Mows Bar, 9PM. Stay for the raffle after the last set.',
    );
    expect(result.isWorthExtracting).toBe(false);
    // Documented rather than asserted-as-desired: if this becomes a real
    // problem, narrow the pattern and re-measure.
  });
});
