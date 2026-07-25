/**
 * The export queries, checked as SQL rather than by running them.
 *
 * Drizzle's builder is typed against the schema, so `npm run typecheck` already proves every
 * column referenced here exists -- a renamed column is a compile error, not a runtime surprise.
 * What typecheck cannot prove is that the WHERE clause says what the docblock claims, which is
 * exactly the part a reader relies on and the part a careless edit breaks silently.
 *
 * `.toSQL()` builds the statement without opening a connection, so this needs no database.
 */
import { describe, expect, it } from 'vitest';
import { manilaToday } from '@wheresthefx/core';
import { eventExportQuery, venueExportQuery } from './tripiExport.js';

describe('venueExportQuery', () => {
  it('selects from venue with no filter, so ungeocoded rows still reach the mapper', () => {
    // Filtering here would turn a documented skip_reason into a silent omission.
    const { sql } = venueExportQuery().toSQL();
    expect(sql).toContain('from "venue"');
    expect(sql).not.toContain('where');
  });

  it('reads the columns the draft mapper needs', () => {
    const { sql } = venueExportQuery().toSQL();
    for (const column of ['"name"', '"address"', '"city"', '"lat"', '"lng"', '"category"']) {
      expect(sql).toContain(column);
    }
  });
});

describe('eventExportQuery', () => {
  it('joins the venue for its city and the source post for a verifiable link', () => {
    const { sql } = eventExportQuery().toSQL();
    expect(sql).toContain('left join "venue"');
    expect(sql).toContain('left join "source_post"');
    expect(sql).toContain('coalesce');
  });

  it('excludes anything that does not belong in an itinerary', () => {
    // A cancelled event or an extractor false positive is worse in a plan than a missing one.
    const { sql, params } = eventExportQuery().toSQL();
    expect(sql).toContain('"event_status" =');
    expect(sql).toContain('"review_tier" <>');
    expect(params).toContain('confirmed');
    expect(params).toContain('rejected');
  });

  it('floors the date window at today in Manila', () => {
    const { params } = eventExportQuery().toSQL();
    expect(params).toContain(manilaToday());
  });

  it('honours a since later than today', () => {
    const { params } = eventExportQuery('2099-01-01').toSQL();
    expect(params).toContain('2099-01-01');
    expect(params).not.toContain(manilaToday());
  });

  it('clamps a since in the past back to today, so the window cannot widen backwards', () => {
    const { params } = eventExportQuery('2001-01-01').toSQL();
    expect(params).toContain(manilaToday());
    expect(params).not.toContain('2001-01-01');
  });

  it('orders by date then time, which is the order a planner reads', () => {
    const { sql } = eventExportQuery().toSQL();
    expect(sql).toMatch(/order by[\s\S]*"event_date"[\s\S]*"event_time"/);
  });
});
