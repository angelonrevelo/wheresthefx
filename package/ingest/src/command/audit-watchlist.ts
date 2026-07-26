import '../env.js';
import { db, event, sql as pgConnection, sourceAccount } from '@wheresthefx/db';
import { sql } from 'drizzle-orm';

/**
 * Report watchlist accounts whose events rarely resolve to a venue.
 *
 *   npx tsx package/ingest/src/command/audit-watchlist.ts
 *
 * ## Why
 *
 * `pacnewport` sat on the active watchlist for months. It is the
 * Performing Arts Center in Newport, **Oregon** — and the mistake is an
 * easy one, because Newport World Resorts in Pasay genuinely operates a
 * "Newport Performing Arts Center". The handle reads correctly.
 *
 * The damage was not that its events were unmapped. It was the opposite:
 * the venue matcher resolved "Newport Performing Arts Center" to the real
 * Pasay row, so 23 events in Oregon appeared on the map at a Pasay
 * address, indistinguishable from real listings. Two more landed on
 * "Alice Silverman Theatre", a venue Nominatim invented in Las Piñas by
 * matching the name "Alice".
 *
 * Coordinate bounds could not catch this. The events were never outside
 * the Philippines in the database — they were inside it and wrong, which
 * is the harder shape of the same problem.
 *
 * ## What this does not do
 *
 * It does not detect a foreign account, and two attempts are recorded
 * here so a third is not made.
 *
 * **Placeability** — the share of an account's events resolving to a
 * directory venue — reads well and is the wrong signal. `pacnewport`
 * placed 32 of 39, 82%, above any sane floor. Placing them WAS the bug.
 *
 * **Foreign geography in the event's own words** looked stronger and is
 * worse. Measured against the real Oregon captions it fired on 2 of 34:
 * "BLOOM NEWPORT", "Newport Symphony Orchestra" and "Enchanted Garden"
 * name no foreign place. Against current data it returned five rows and
 * all five were wrong — "Dear Seattle" is a band, "Lollapalooza ft.
 * SB19" is at the Mall of Asia. Six percent recall at zero precision is
 * not a safeguard, it is a source of false confidence, so it is not here.
 *
 * Nothing stored about an account says which country it is in. That is a
 * one-time human pass over 200 profiles, not a heuristic.
 *
 * What the report below IS good for: accounts whose posts never name a
 * location, which is a real and separate content problem.
 */

/** Below this share of placeable events, an account is worth a look. */
const PLACEABLE_FLOOR = 0.5;

/** Too few events and the ratio is noise rather than signal. */
const MIN_EVENT_TO_JUDGE = 5;

async function main(): Promise<void> {
  const rowList = await db
    .select({
      username: sourceAccount.username,
      fullName: sourceAccount.fullName,
      isActive: sourceAccount.isActive,
      total: sql<number>`count(${event.eventId})::int`,
      placed: sql<number>`count(${event.venueLat})::int`,
    })
    .from(sourceAccount)
    .leftJoin(event, sql`${event.sourceUsername} = ${sourceAccount.username}`)
    .groupBy(sourceAccount.username, sourceAccount.fullName, sourceAccount.isActive);

  const judged = rowList
    .filter(row => row.total >= MIN_EVENT_TO_JUDGE)
    .map(row => ({ ...row, share: row.placed / row.total }))
    .filter(row => row.share < PLACEABLE_FLOOR)
    .sort((a, b) => a.share - b.share);

  console.log(
    `${rowList.length} account(s), ${judged.length} with under `
    + `${Math.round(PLACEABLE_FLOOR * 100)}% of their events placeable\n`,
  );

  if (judged.length === 0) {
    console.log('Nothing to review.');
  }

  for (const row of judged) {
    console.log(
      `  ${Math.round(row.share * 100).toString().padStart(3)}%  `
      + `${row.username.padEnd(26)} ${String(row.placed).padStart(3)}/${String(row.total).padEnd(4)} `
      + `${row.isActive ? 'active  ' : 'inactive'} ${row.fullName ?? ''}`,
    );
  }

  console.log(
    '\nA low share is a question, not a verdict. It reads the same for a '
    + 'run club whose posts never name a venue as for an account in '
    + 'another country. Open the profile and decide.',
  );

  await pgConnection.end({ timeout: 5 });
}

void main();
