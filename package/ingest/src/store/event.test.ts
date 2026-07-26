import { describe, expect, it } from 'vitest';
import { titleSimilarity } from '../identity/hash.js';
import { isSameEvent } from './event.js';

/**
 * Every case here is scoped to one date; the caller only ever asks about
 * same-date rows.
 *
 * The asymmetry to keep in mind: a missed merge shows two cards, which
 * someone might notice and report. A wrong merge deletes an event from
 * the product silently. These lean toward keeping rows separate.
 */

const ACCOUNT = 1784;
const OTHER_ACCOUNT = 9021;

describe('isSameEvent — shared venue', () => {
  it('merges near-identical titles at the same venue', () => {
    // The case the fuzzy tier was built for: the content hash cannot
    // catch it because "festival" and "fest" normalise differently.
    const similarity = titleSimilarity(
      'PORKLABANAN: National Hog Festival 2026',
      'Porklabanan: National Hog Fest',
    );
    expect(isSameEvent({ venueName: 'Nokal' }, { venueName: 'Nokal' }, similarity)).toBe(true);
  });

  it('keeps unrelated events at one venue separate', () => {
    const similarity = titleSimilarity('Jazz Night', 'Salcedo Weekend Market');
    expect(isSameEvent({ venueName: 'Nokal' }, { venueName: 'Nokal' }, similarity)).toBe(false);
  });

  it('never merges the same night name across two bars', () => {
    // Two bars can run a club night with the same name. Identical titles
    // are not enough when the venues disagree.
    expect(isSameEvent({ venueName: 'Nokal' }, { venueName: "Mow's Bar" }, 1)).toBe(false);
  });
});

describe('isSameEvent — one side has no venue', () => {
  const withVenue = { venueName: 'Electric Studio PH', sourceAccountId: ACCOUNT };
  const withoutVenue = { venueName: null, sourceAccountId: ACCOUNT };

  it('merges the live-run case that produced two rows', () => {
    // "Electric All In Challenge" landed with a venue and
    // "ELECTRIC ALL IN CHALLENGE" without one, same date, same account.
    // The hash includes the venue, so they did not collide.
    const similarity = titleSimilarity('Electric All In Challenge', 'ELECTRIC ALL IN CHALLENGE');
    expect(similarity).toBeGreaterThanOrEqual(0.9);
    expect(isSameEvent(withVenue, withoutVenue, similarity)).toBe(true);
    expect(isSameEvent(withoutVenue, withVenue, similarity)).toBe(true);
  });

  it('holds out for a near-identical title, not merely a similar one', () => {
    // 0.8 clears the venue-backed bar and not this one. An account that
    // runs a weekly series posts many titles in this band.
    expect(isSameEvent(withVenue, withoutVenue, 0.8)).toBe(false);
    expect(isSameEvent(withVenue, withoutVenue, 0.9)).toBe(true);
  });

  it('refuses to merge across accounts', () => {
    // Two promoters covering the same night are two posts, and with no
    // venue on either side there is nothing left to confirm the match.
    expect(isSameEvent(
      { venueName: null, sourceAccountId: ACCOUNT },
      { venueName: null, sourceAccountId: OTHER_ACCOUNT },
      1,
    )).toBe(false);
  });

  it('refuses to merge when the account is unknown on either side', () => {
    expect(isSameEvent({ venueName: null }, { venueName: null, sourceAccountId: ACCOUNT }, 1))
      .toBe(false);
    expect(isSameEvent({ venueName: null }, { venueName: null }, 1)).toBe(false);
  });

  it('does not collapse a recurring series into one row', () => {
    // Same account, no venue, same date — but distinct nights. Titles
    // this different must stay apart or a whole week becomes one event.
    const similarity = titleSimilarity('Open Mic Night Vol. 12', 'Open Decks Vol. 3');
    expect(isSameEvent(withoutVenue, { venueName: null, sourceAccountId: ACCOUNT }, similarity))
      .toBe(false);
  });
});

describe('isSameEvent — a legacy row has a username but no account id', () => {
  // Events carried across from the recovered snapshot never got a
  // source_account_id. Comparing ids alone meant a legacy row could never
  // merge with its re-extracted twin, which is the one pair the venue-less
  // rule exists for. Re-extraction produced hundreds of identically
  // titled pairs it refused to merge for want of an id neither would have.
  const legacy = { venueName: null, sourceAccountId: null, sourceUsername: 'soukpopup' };
  const fresh = { venueName: 'Estancia', sourceAccountId: ACCOUNT, sourceUsername: 'soukpopup' };

  it('merges on the username when one side has no account id', () => {
    expect(isSameEvent(legacy, fresh, 1)).toBe(true);
  });

  it('is case-insensitive, because the two sources cased it differently', () => {
    expect(isSameEvent(legacy, { ...fresh, sourceUsername: 'SoukPopup' }, 1)).toBe(true);
  });

  it('still refuses two different accounts', () => {
    expect(isSameEvent(legacy, { ...fresh, sourceUsername: 'otherpromoter' }, 1)).toBe(false);
  });

  it('still demands a near-identical title', () => {
    expect(isSameEvent(legacy, fresh, 0.8)).toBe(false);
  });

  it('still refuses when both venues are named and differ', () => {
    expect(isSameEvent(
      { venueName: 'Estancia', sourceUsername: 'soukpopup' },
      { venueName: 'Rizal Row', sourceUsername: 'soukpopup' },
      1,
    )).toBe(false);
  });
});
