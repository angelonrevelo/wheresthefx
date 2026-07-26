import { describe, expect, it } from 'vitest';
import { asEventDate, asPrice, asTime, looksLikeHandle, parseExtractionResponse, stripCodeFence } from './parse.js';

const POSTED = new Date('2026-07-26T00:00:00Z');

function parse(payload: Record<string, unknown>) {
  return parseExtractionResponse(JSON.stringify(payload), POSTED);
}

describe('stripCodeFence', () => {
  it('removes the fences the model adds despite instructions', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });
});

describe('parseExtractionResponse — resilience', () => {
  it('never throws on unparseable input', () => {
    for (const raw of ['', 'not json', '{broken', 'null', '[]', '42']) {
      const { result } = parseExtractionResponse(raw, POSTED);
      expect(result.isEvent).toBe(false);
      expect(result.confidence).toBe(0);
    }
  });

  it('handles a fenced response', () => {
    const { result } = parseExtractionResponse(
      '```json\n{"isEvent":true,"eventTitle":"Gig","category":"music","confidence":0.9}\n```',
      POSTED,
    );
    expect(result.isEvent).toBe(true);
    expect(result.eventTitle).toBe('Gig');
    expect(result.category).toBe('music');
  });
});

describe('asPrice — the phone-number rule', () => {
  it('accepts plausible prices', () => {
    expect(asPrice(500)).toBe(500);
    expect(asPrice('₱1,200')).toBe(1200);
  });

  it('rejects zero, because free is expressed by isFree not price: 0', () => {
    expect(asPrice(0)).toBeNull();
  });

  it('rejects negatives and unparseable values', () => {
    expect(asPrice(-100)).toBeNull();
    expect(asPrice('abc')).toBeNull();
    expect(asPrice(null)).toBeNull();
  });

  it('rejects values above ₱50,000 as phone numbers', () => {
    expect(asPrice(9171234567)).toBeNull();
    expect(asPrice(50_001)).toBeNull();
    expect(asPrice(50_000)).toBe(50_000);
  });
});

describe('asEventDate — hallucination guard', () => {
  it('accepts a plausible near-future date', () => {
    expect(asEventDate('2026-08-15', POSTED)).toBe('2026-08-15');
  });

  it('rejects dates beyond the 18-month horizon', () => {
    expect(asEventDate('2029-01-01', POSTED)).toBeNull();
  });

  it('rejects dates before the product existed', () => {
    expect(asEventDate('2023-06-01', POSTED)).toBeNull();
  });

  it('rejects impossible and malformed dates', () => {
    expect(asEventDate('2026-02-31', POSTED)).toBeNull();
    expect(asEventDate('2026-13-01', POSTED)).toBeNull();
    expect(asEventDate('15/08/2026', POSTED)).toBeNull();
    expect(asEventDate('', POSTED)).toBeNull();
    expect(asEventDate(null, POSTED)).toBeNull();
  });
});

describe('asTime', () => {
  it('accepts 24-hour HH:MM', () => {
    expect(asTime('19:00')).toBe('19:00');
    expect(asTime('00:00')).toBe('00:00');
    expect(asTime('23:59')).toBe('23:59');
  });

  it('rejects 12-hour and out-of-range values', () => {
    for (const value of ['7PM', '7:00 PM', '24:00', '19:60', '9:00', '']) {
      expect(asTime(value), `should reject ${value}`).toBeNull();
    }
  });
});

describe('category handling', () => {
  it('accepts canonical categories', () => {
    expect(parse({ category: 'nightlife' }).result.category).toBe('nightlife');
  });

  it('maps retired values forward', () => {
    expect(parse({ category: 'art_culture' }).result.category).toBe('arts');
  });

  it('surfaces an unknown category instead of coercing it to `other`', () => {
    // Silent coercion is exactly how five categories were lost before.
    const outcome = parse({ category: 'karaoke' });
    expect(outcome.result.category).toBeNull();
    expect(outcome.unknownCategory).toBe('karaoke');
  });

  it('reports no unknown when the field is absent', () => {
    expect(parse({ isEvent: true }).unknownCategory).toBeNull();
  });
});

describe('free vs paid', () => {
  it('keeps a genuinely free event free', () => {
    const { result } = parse({ isFree: true, price: null });
    expect(result.isFree).toBe(true);
    expect(result.price).toBeNull();
  });

  it('treats free-entrance-with-consumable as paid', () => {
    // The standard Manila nightlife model: the model sometimes returns
    // isFree:true alongside the consumable amount. The price wins.
    const { result } = parse({ isFree: true, price: 500, priceNotes: 'Free entrance, ₱500 consumable' });
    expect(result.isFree).toBe(false);
    expect(result.price).toBe(500);
  });

  it('normalises price: 0 to null without flipping isFree', () => {
    const { result } = parse({ isFree: true, price: 0 });
    expect(result.price).toBeNull();
    expect(result.isFree).toBe(true);
  });
});

describe('confidence', () => {
  it('clamps to [0,1]', () => {
    expect(parse({ confidence: 1.7 }).result.confidence).toBe(1);
    expect(parse({ confidence: -3 }).result.confidence).toBe(0);
    expect(parse({ confidence: 0.85 }).result.confidence).toBe(0.85);
  });

  it('defaults to 0 when absent or unparseable', () => {
    expect(parse({}).result.confidence).toBe(0);
    expect(parse({ confidence: 'high' }).result.confidence).toBe(0);
  });
});

describe('list fields', () => {
  it('filters invalid dates out of allEventDates', () => {
    const { result } = parse({
      allEventDates: ['2026-08-01', 'garbage', '2029-01-01', '2026-08-02'],
    });
    expect(result.allEventDateList).toEqual(['2026-08-01', '2026-08-02']);
  });

  it('returns null rather than an empty array', () => {
    expect(parse({ allEventDates: [] }).result.allEventDateList).toBeNull();
    expect(parse({ artists: ['', '  '] }).result.artistList).toBeNull();
  });

  it('keeps full multi-word band names intact', () => {
    const { result } = parse({ artists: ['I Belong to the Zoo', 'One Click Straight'] });
    expect(result.artistList).toEqual(['I Belong to the Zoo', 'One Click Straight']);
  });
});

describe('sub-events', () => {
  it('drops entries without a title', () => {
    const { result } = parse({
      subEvents: [
        { title: 'Set 1', time: '20:00' },
        { time: '22:00' },
      ],
    });
    expect(result.subEventList).toHaveLength(1);
    expect(result.subEventList?.[0].title).toBe('Set 1');
  });

  it('validates nested dates and times', () => {
    const { result } = parse({
      subEvents: [{ title: 'Set 1', date: '2029-01-01', time: '7PM' }],
    });
    expect(result.subEventList?.[0].date).toBeNull();
    expect(result.subEventList?.[0].time).toBeNull();
  });
});

describe('enum fields', () => {
  it('defaults locationStatus to confirmed on an unknown value', () => {
    expect(parse({ locationStatus: 'nonsense' }).result.locationStatus).toBe('confirmed');
    expect(parse({ locationStatus: 'secret' }).result.locationStatus).toBe('secret');
  });

  it('nulls unknown urlType and availabilityStatus', () => {
    expect(parse({ urlType: 'carrier-pigeon' }).result.urlType).toBeNull();
    expect(parse({ availabilityStatus: 'maybe' }).result.availabilityStatus).toBeNull();
    expect(parse({ availabilityStatus: 'sold_out' }).result.availabilityStatus).toBe('sold_out');
  });
});

describe('looksLikeHandle — a venue is not an @mention', () => {
  it('rejects the posting account own handle', () => {
    // "electricstudioph" reached the venue directory from a live run,
    // despite the prompt forbidding it. A handle cannot be geocoded and
    // becomes a junk directory row.
    expect(looksLikeHandle('electricstudioph', 'electricstudioph')).toBe(true);
    expect(looksLikeHandle('mowsbar', 'mowsbar')).toBe(true);
  });

  it('rejects handle-shaped strings generally', () => {
    expect(looksLikeHandle('creative.workshops.mnl')).toBe(true);
    expect(looksLikeHandle('the_funroof')).toBe(true);
    expect(looksLikeHandle('electricstudioph')).toBe(true);
  });

  it('accepts real venue names', () => {
    for (const name of ["Mow's Bar", '19 East', 'SM Mall of Asia Arena', 'Apotheka Manila', 'Nokal']) {
      expect(looksLikeHandle(name), name).toBe(false);
    }
  });

  it('never rejects a multi-word name', () => {
    // Spaces are the clearest signal a human wrote it as a place.
    expect(looksLikeHandle('Electric Studio PH')).toBe(false);
  });

  it('nulls a handle venue during parsing', () => {
    const { result } = parseExtractionResponse(
      JSON.stringify({ isEvent: true, venueName: 'electricstudioph' }),
      new Date('2026-07-26T00:00:00Z'),
      'electricstudioph',
    );
    expect(result.venueName).toBeNull();
  });

  it('keeps a real venue during parsing', () => {
    const { result } = parseExtractionResponse(
      JSON.stringify({ isEvent: true, venueName: 'Electric Studio PH' }),
      new Date('2026-07-26T00:00:00Z'),
      'electricstudioph',
    );
    expect(result.venueName).toBe('Electric Studio PH');
  });
});
