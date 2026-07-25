import { describe, expect, it } from 'vitest';
import {
  escapeLikeTerm,
  firstParam,
  parseBool,
  parseBoundedInt,
  parseId,
  parseIsoDate,
} from './param.js';

describe('firstParam', () => {
  it('collapses a repeated param to its first usable value', () => {
    // `?category=a&category=b` arrives as an array. The routes used to pass
    // this straight into a Drizzle enum comparison, producing a 500.
    expect(firstParam(['nightlife', 'music'])).toBe('nightlife');
  });

  it('treats empty and missing as absent', () => {
    expect(firstParam('')).toBeUndefined();
    expect(firstParam(undefined)).toBeUndefined();
    expect(firstParam([])).toBeUndefined();
    expect(firstParam(['', 'music'])).toBe('music');
  });
});

describe('parseId', () => {
  it('accepts positive integers', () => {
    expect(parseId('42')).toBe(42);
  });

  it('rejects partially-numeric strings that parseInt would accept', () => {
    // parseInt('12abc') === 12 — the old behaviour silently accepted this.
    expect(parseId('12abc')).toBeUndefined();
  });

  it('rejects zero, negatives, fractions, and junk', () => {
    expect(parseId('0')).toBeUndefined();
    expect(parseId('-1')).toBeUndefined();
    expect(parseId('1.5')).toBeUndefined();
    expect(parseId('abc')).toBeUndefined();
    expect(parseId(undefined)).toBeUndefined();
  });
});

describe('parseBoundedInt', () => {
  const bound = { min: 1, max: 100, fallback: 20 };

  it('falls back when absent or unparseable', () => {
    expect(parseBoundedInt(undefined, bound)).toBe(20);
    expect(parseBoundedInt('abc', bound)).toBe(20);
  });

  it('clamps rather than rejecting', () => {
    expect(parseBoundedInt('500', bound)).toBe(100);
    expect(parseBoundedInt('0', bound)).toBe(1);
    expect(parseBoundedInt('50', bound)).toBe(50);
  });
});

describe('parseBool', () => {
  it('maps only the exact strings', () => {
    expect(parseBool('true')).toBe(true);
    expect(parseBool('false')).toBe(false);
    expect(parseBool('1')).toBeUndefined();
    expect(parseBool('yes')).toBeUndefined();
    expect(parseBool(undefined)).toBeUndefined();
  });
});

describe('parseIsoDate', () => {
  it('accepts a real calendar date', () => {
    expect(parseIsoDate('2026-07-26')).toBe('2026-07-26');
  });

  it('rejects impossible dates rather than passing them to Postgres', () => {
    // `?date_from=notadate` and `?date_from=2026-02-31` both used to reach
    // the query builder and surface as a 500.
    expect(parseIsoDate('2026-02-31')).toBeUndefined();
    expect(parseIsoDate('2026-13-01')).toBeUndefined();
    expect(parseIsoDate('notadate')).toBeUndefined();
    expect(parseIsoDate('26-07-2026')).toBeUndefined();
    expect(parseIsoDate(undefined)).toBeUndefined();
  });

  it('accepts a leap day in a leap year and rejects it otherwise', () => {
    expect(parseIsoDate('2028-02-29')).toBe('2028-02-29');
    expect(parseIsoDate('2026-02-29')).toBeUndefined();
  });
});

describe('escapeLikeTerm', () => {
  it('neutralises the wildcards that made `?search=%` a full scan', () => {
    expect(escapeLikeTerm('%')).toBe('\\%');
    expect(escapeLikeTerm('_')).toBe('\\_');
    expect(escapeLikeTerm('100%_off')).toBe('100\\%\\_off');
  });

  it('escapes the escape character itself', () => {
    expect(escapeLikeTerm('a\\b')).toBe('a\\\\b');
  });

  it('leaves ordinary search text alone', () => {
    expect(escapeLikeTerm('jazz night')).toBe('jazz night');
  });
});
