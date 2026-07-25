import { describe, expect, it } from 'vitest';
import { isUpcomingInManila, manilaDateOffset, manilaToday } from './time.js';

describe('manilaToday', () => {
  it('returns the Manila date, not the UTC date, during the +8 window', () => {
    // 2026-07-26 00:30 PHT is still 2026-07-25 16:30 UTC.
    // The old `toISOString().split('T')[0]` returned 2026-07-25 here —
    // the exact regression this replaces.
    const justAfterManilaMidnight = new Date('2026-07-25T16:30:00Z');

    expect(manilaToday(justAfterManilaMidnight)).toBe('2026-07-26');
    expect(justAfterManilaMidnight.toISOString().split('T')[0]).toBe('2026-07-25');
  });

  it('agrees with UTC once Manila and UTC share a calendar day', () => {
    const midMorningUtc = new Date('2026-07-26T09:00:00Z');
    expect(manilaToday(midMorningUtc)).toBe('2026-07-26');
  });

  it('rolls over exactly at Manila midnight', () => {
    expect(manilaToday(new Date('2026-07-25T15:59:59Z'))).toBe('2026-07-25');
    expect(manilaToday(new Date('2026-07-25T16:00:00Z'))).toBe('2026-07-26');
  });

  it('formats as zero-padded YYYY-MM-DD', () => {
    expect(manilaToday(new Date('2026-01-05T03:00:00Z'))).toBe('2026-01-05');
  });
});

describe('manilaDateOffset', () => {
  it('returns today for a zero offset', () => {
    const now = new Date('2026-07-26T02:00:00Z');
    expect(manilaDateOffset(0, now)).toBe(manilaToday(now));
  });

  it('moves forward and backward by whole days', () => {
    const now = new Date('2026-07-26T02:00:00Z');
    expect(manilaDateOffset(1, now)).toBe('2026-07-27');
    expect(manilaDateOffset(-1, now)).toBe('2026-07-25');
    expect(manilaDateOffset(7, now)).toBe('2026-08-02');
  });

  it('crosses month and year boundaries', () => {
    expect(manilaDateOffset(1, new Date('2026-01-31T02:00:00Z'))).toBe('2026-02-01');
    expect(manilaDateOffset(1, new Date('2026-12-31T02:00:00Z'))).toBe('2027-01-01');
    expect(manilaDateOffset(-1, new Date('2026-01-01T02:00:00Z'))).toBe('2025-12-31');
  });

  it('handles a leap day', () => {
    expect(manilaDateOffset(1, new Date('2028-02-28T02:00:00Z'))).toBe('2028-02-29');
  });
});

describe('isUpcomingInManila', () => {
  it('counts an event later today as upcoming', () => {
    // 00:30 PHT — the window where the old UTC comparison hid tonight's events.
    const now = new Date('2026-07-25T16:30:00Z');
    expect(isUpcomingInManila('2026-07-26', now)).toBe(true);
  });

  it('excludes yesterday', () => {
    const now = new Date('2026-07-25T16:30:00Z');
    expect(isUpcomingInManila('2026-07-25', now)).toBe(false);
  });
});
