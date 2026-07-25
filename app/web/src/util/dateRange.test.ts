import { describe, expect, it } from 'vitest';
import { resolveDateRange } from './dateRange.js';

// 2026-07-26 is a Sunday. 10:00 UTC = 18:00 PHT, same calendar day in both.
const SUNDAY = new Date('2026-07-26T10:00:00Z');
// 2026-07-22 is a Wednesday.
const WEDNESDAY = new Date('2026-07-22T10:00:00Z');

describe('resolveDateRange', () => {
  it('returns undefined for "all" so no date filter is applied', () => {
    expect(resolveDateRange('all', SUNDAY)).toBeUndefined();
  });

  it('makes "today" a single Manila day', () => {
    expect(resolveDateRange('today', SUNDAY)).toEqual({
      start: '2026-07-26',
      end: '2026-07-26',
    });
  });

  it('computes "today" from the Manila date during the UTC+8 window', () => {
    // 16:30 UTC on the 25th is already the 26th in Manila.
    const justAfterManilaMidnight = new Date('2026-07-25T16:30:00Z');
    expect(resolveDateRange('today', justAfterManilaMidnight)).toEqual({
      start: '2026-07-26',
      end: '2026-07-26',
    });
  });

  it('spans seven days for "week"', () => {
    expect(resolveDateRange('week', SUNDAY)).toEqual({
      start: '2026-07-26',
      end: '2026-08-02',
    });
  });

  it('finds the upcoming Fri–Sun for "weekend"', () => {
    // From Wednesday the 22nd, the next Friday is the 24th.
    expect(resolveDateRange('weekend', WEDNESDAY)).toEqual({
      start: '2026-07-24',
      end: '2026-07-26',
    });
  });

  it('treats Friday itself as this weekend, not next', () => {
    const friday = new Date('2026-07-24T10:00:00Z');
    expect(resolveDateRange('weekend', friday)).toEqual({
      start: '2026-07-24',
      end: '2026-07-26',
    });
  });

  it('spans 30 days for "month" and crosses the month boundary', () => {
    expect(resolveDateRange('month', SUNDAY)).toEqual({
      start: '2026-07-26',
      end: '2026-08-25',
    });
  });
});
