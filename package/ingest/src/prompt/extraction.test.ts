import { describe, expect, it } from 'vitest';
import { CATEGORY } from '@wheresthefx/core';
import { PROMPT_VERSION, buildExtractionPrompt } from './extraction.js';

/**
 * These pin the rules that were expensive to learn and are cheap to break.
 *
 * They assert the prompt still *contains* each rule — not that the model
 * obeys it. Model-behaviour checks need a live API key and live in the
 * golden-fixture suite; these run in CI on every commit and catch the
 * far more common failure, which is someone "tidying" the prompt and
 * deleting a rule that looked redundant.
 */

const BASE = { caption: 'Test event', username: 'testvenue', postedAt: '2026-07-26' };

describe('PROMPT_VERSION', () => {
  it('is semver', () => {
    expect(PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('prompt structure', () => {
  it('includes the post date and account, which anchor all relative dates', () => {
    const prompt = buildExtractionPrompt(BASE);
    expect(prompt).toContain('POST DATE: 2026-07-26');
    expect(prompt).toContain('ACCOUNT: @testvenue');
  });

  it('falls back to today when the post date is missing or unparseable', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(buildExtractionPrompt({ caption: 'x' })).toContain(`POST DATE: ${today}`);
    expect(buildExtractionPrompt({ ...BASE, postedAt: 'garbage' })).toContain(`POST DATE: ${today}`);
  });

  it('contains all 11 extraction steps', () => {
    const prompt = buildExtractionPrompt(BASE);
    for (let step = 1; step <= 11; step++) {
      expect(prompt, `missing STEP ${step}`).toContain(`STEP ${step}:`);
    }
  });
});

describe('category taxonomy', () => {
  it('lists every canonical category, derived from core rather than hardcoded', () => {
    const prompt = buildExtractionPrompt(BASE);
    expect(prompt).toContain(`One of: ${CATEGORY.join(' | ')}`);
    for (const category of CATEGORY) {
      expect(prompt, `prompt omits ${category}`).toContain(category);
    }
  });

  it('forbids the "other" escape hatch that used to swallow five categories', () => {
    expect(buildExtractionPrompt(BASE)).toContain('Do NOT use "other"');
  });
});

describe('hard-won rules that must survive edits', () => {
  const prompt = buildExtractionPrompt(BASE);

  it('keeps the multi-range date rule', () => {
    // "March 21-22 & 28-29" is 4 days, not 9. Flattening this is the
    // single most damaging date bug the pipeline has had.
    expect(prompt).toContain('NEVER flatten "X-Y & A-B" into one continuous range');
    expect(prompt).toContain('THIS IS NOT continuous Mar 21-29');
  });

  it('keeps the free-entrance-with-consumable rule', () => {
    // The standard Manila nightlife pricing model. Getting this wrong
    // marks paid events as free on the map.
    expect(prompt).toContain('Free entrance, ₱500 consumable');
    expect(prompt).toContain('isFree: false, price: 500');
  });

  it('keeps free meaning null, never zero', () => {
    expect(prompt).toContain('isFree: true, price: null (NEVER 0)');
  });

  it('keeps the phone-number-is-not-a-price rule', () => {
    expect(prompt).toContain('₱50,000');
    expect(prompt).toContain('"09XX" patterns = phone numbers, NOT prices');
  });

  it('keeps Filipino date and time vocabulary', () => {
    for (const token of ['Dis 15', 'Enero 3', 'ngayong Sabado', 'sa Biyernes', 'alas-7 ng gabi', 'tanghali', 'hatinggabi', 'Libre']) {
      expect(prompt, `lost Filipino token: ${token}`).toContain(token);
    }
  });

  it('keeps hosts out of the artist list', () => {
    expect(prompt).toContain('Inka is the host, NOT a performer');
  });

  it('keeps market vendors out of sub-events', () => {
    expect(prompt).toContain('Market VENDORS are NOT sub-events');
  });

  it('keeps the doors-vs-show-time rule', () => {
    expect(prompt).toContain('eventTime = the EARLIER time (doors/gates)');
  });

  it('keeps per-category time estimation rather than leaving time null', () => {
    expect(prompt).toContain('Users need a time.');
    expect(prompt).toContain('markets/bazaars → "10:00"');
  });

  it('keeps the non-event blocklist', () => {
    for (const token of ['#tbt', 'raffle', 'Cinema/movie schedules', 'Hiring posts', 'grand openings']) {
      expect(prompt, `lost blocklist entry: ${token}`).toContain(token);
    }
  });
});

describe('known-venue context', () => {
  it('is omitted when there are no known venues', () => {
    expect(buildExtractionPrompt(BASE)).not.toContain('KNOWN VENUES');
  });

  it('lists venues and demands exact spelling', () => {
    const prompt = buildExtractionPrompt({ ...BASE, knownVenueList: ['19 East', 'Mow\'s Bar'] });
    expect(prompt).toContain('KNOWN VENUES (2');
    expect(prompt).toContain('19 East, Mow\'s Bar');
    expect(prompt).toContain('use the EXACT spelling');
  });

  it('caps the list at 120 and says how many were withheld', () => {
    const venueList = Array.from({ length: 200 }, (_, i) => `Venue ${i}`);
    const prompt = buildExtractionPrompt({ ...BASE, knownVenueList: venueList });
    expect(prompt).toContain('KNOWN VENUES (200');
    expect(prompt).toContain('and 80 more');
    expect(prompt).not.toContain('Venue 150');
  });
});

describe('venue profile override', () => {
  it('is omitted without a profile', () => {
    expect(buildExtractionPrompt(BASE)).not.toContain('VENUE PROFILE');
  });

  it('fires the strong nightlife override for a bar dominated by nightlife', () => {
    // This is the lever that stops a themed DJ night at a jazz bar being
    // filed as `music`.
    const prompt = buildExtractionPrompt({
      ...BASE,
      venueProfile: {
        venueType: 'jazz_bar',
        categoryDistribution: { nightlife: 0.8, music: 0.2 },
      },
    });
    expect(prompt).toContain('🚨 CRITICAL');
    expect(prompt).toContain('80% of events are nightlife');
    expect(prompt).toContain('MUST be classified as "nightlife", NOT "music"');
  });

  it('uses the soft hint when nightlife is present but not dominant', () => {
    const prompt = buildExtractionPrompt({
      ...BASE,
      venueProfile: {
        venueType: 'bar',
        categoryDistribution: { nightlife: 0.4, music: 0.6 },
      },
    });
    expect(prompt).not.toContain('🚨 CRITICAL');
    expect(prompt).toContain('⚠️ Use this as context');
  });

  it('does not fire the strong override for a non-bar venue', () => {
    const prompt = buildExtractionPrompt({
      ...BASE,
      venueProfile: {
        venueType: 'arena',
        categoryDistribution: { nightlife: 0.9 },
      },
    });
    expect(prompt).not.toContain('🚨 CRITICAL');
  });

  it('includes typical hours and recurring events when known', () => {
    const prompt = buildExtractionPrompt({
      ...BASE,
      venueProfile: {
        venueType: 'bar',
        typicalHours: '21:00',
        recurringEventList: [{ name: 'Planet Groove', frequency: 'weekly' }],
      },
    });
    expect(prompt).toContain('Typical start time: 21:00');
    expect(prompt).toContain('"Planet Groove" (weekly)');
  });
});

describe('response schema', () => {
  it('requests every field the pipeline persists', () => {
    const prompt = buildExtractionPrompt(BASE);
    for (const field of [
      'isEvent', 'eventTitle', 'eventDate', 'eventEndDate', 'allEventDates',
      'eventTime', 'endTime', 'description', 'artists', 'venueName',
      'venueAddress', 'locationStatus', 'price', 'priceMin', 'priceMax',
      'priceNotes', 'isFree', 'signupUrl', 'urlType', 'category',
      'availabilityStatus', 'confidence', 'isRecurring', 'recurrencePattern',
      'isHistoricalPost', 'reasoning', 'subEvents', 'ocrText',
    ]) {
      expect(prompt, `schema omits ${field}`).toContain(`"${field}"`);
    }
  });
});
