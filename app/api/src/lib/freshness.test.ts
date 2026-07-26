import { describe, expect, it } from 'vitest';
import { INGEST_STALE_AFTER_MS, readIngestFreshness } from './freshness.js';

const NOW = new Date('2026-07-26T12:00:00Z').getTime();

describe('readIngestFreshness', () => {
  it('accepts the string the driver actually returns', () => {
    // This is the exact shape postgres.js handed back, and the exact
    // reason the health endpoint reported "never synced" for hours after
    // two successful ingests.
    const result = readIngestFreshness('2026-07-26 09:18:58.706+02', NOW);
    expect(result.lastSyncAt).toBe('2026-07-26T07:18:58.706Z');
    expect(result.isStale).toBe(false);
  });

  it('accepts a Date, in case the driver changes its mind', () => {
    const result = readIngestFreshness(new Date('2026-07-26T09:00:00Z'), NOW);
    expect(result.lastSyncAt).toBe('2026-07-26T09:00:00.000Z');
    expect(result.isStale).toBe(false);
  });

  it('reports stale when nothing has ever completed', () => {
    expect(readIngestFreshness(null, NOW)).toEqual({ lastSyncAt: null, isStale: true });
    expect(readIngestFreshness(undefined, NOW)).toEqual({ lastSyncAt: null, isStale: true });
  });

  it('reports stale rather than throwing on an unparseable value', () => {
    // Failing closed is right; failing closed *silently* is what caused
    // the problem, so this path is now explicit and covered.
    expect(readIngestFreshness('not a timestamp', NOW))
      .toEqual({ lastSyncAt: null, isStale: true });
  });

  it('goes stale exactly at the 24h boundary', () => {
    const justInside = new Date(NOW - INGEST_STALE_AFTER_MS + 1000);
    const justOutside = new Date(NOW - INGEST_STALE_AFTER_MS - 1000);
    expect(readIngestFreshness(justInside, NOW).isStale).toBe(false);
    expect(readIngestFreshness(justOutside, NOW).isStale).toBe(true);
  });

  it('would have caught the four-month outage', () => {
    // The original failure: the pipeline stopped on 19 June and nothing
    // said so until someone counted the events in July.
    const result = readIngestFreshness('2026-06-19T03:28:00Z', NOW);
    expect(result.isStale).toBe(true);
    expect(result.lastSyncAt).toBe('2026-06-19T03:28:00.000Z');
  });
});
