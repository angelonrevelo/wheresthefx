import '../env.js';
import { db, event, sql as pgConnection, venue } from '@wheresthefx/db';
import { eq, isNotNull } from 'drizzle-orm';
import { looksLikeNonVenue } from '../extractor/parse.js';

/**
 * Clear venue names that name no venue.
 *
 *   npx tsx package/ingest/src/command/clear-nonvenue.ts [--dry-run]
 *
 * ## Why this exists
 *
 * The extraction prompt has forbidden bare room names since the port, and
 * the current model obeys it: every offending row in the directory came
 * from the legacy re-ingest, and the first autonomous scrape produced
 * none. So this is a one-off cleanup of inherited data rather than a
 * standing repair — but it is worth running after any future re-ingest,
 * and it is idempotent.
 *
 * What it removes, all of it observed in production:
 *
 * - "Activity Center" (14 events, no coordinate), "Atrium", "Open Space",
 *   "Multiple Locations", "the bar" — rooms and placeholders that cannot
 *   be navigated to and that pull unrelated events onto one row.
 * - A caption fragment that reached the field intact: "Where: Manila
 *   (Exact location to be sent to confirmed participants) When: ...".
 *
 * It does NOT remove a venue whose name matches the event title. That
 * rule was in the first draft and a dry run killed it: "Vice Comedy
 * Club", "Legazpi Sunday Market" and "House Collab Underground" are real
 * places whose events carry their name.
 *
 * The predicate is the pipeline's own, so the backfill and the extractor
 * cannot disagree about what counts as a venue.
 *
 * Coordinates are cleared along with the name here, unlike the handle
 * repair: a bare "Atrium" never geocoded to anything real in the first
 * place, and where one of these did acquire a pin it is a guess.
 */

async function main(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');

  const candidateList = await db
    .select({
      eventId: event.eventId,
      title: event.title,
      venueName: event.venueName,
      venueId: event.venueId,
      venueLat: event.venueLat,
    })
    .from(event)
    .where(isNotNull(event.venueName));

  const affectedList = candidateList.filter(
    row => row.venueName && looksLikeNonVenue(row.venueName),
  );

  console.log(
    `${candidateList.length} event(s) with a venue name, `
    + `${affectedList.length} naming no venue${isDryRun ? ' (dry run)' : ''}\n`,
  );

  const byName = new Map<string, number>();
  for (const row of affectedList) {
    byName.set(row.venueName as string, (byName.get(row.venueName as string) ?? 0) + 1);
  }
  for (const [name, total] of [...byName].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(total).padStart(3)}x  ${JSON.stringify(name.slice(0, 70))}`);
  }

  if (!isDryRun) {
    for (const row of affectedList) {
      await db.update(event)
        .set({
          venueName: null,
          venueId: null,
          venueLat: null,
          venueLng: null,
          updatedAt: new Date(),
        })
        .where(eq(event.eventId, row.eventId));
    }
  }

  // Directory rows that are themselves not venues go too, once nothing
  // points at them. Left behind they keep appearing in the venue list and
  // keep attracting matches from `VenueIndex`.
  const venueList = await db
    .select({ venueId: venue.venueId, name: venue.name })
    .from(venue);

  const junkVenueList = venueList.filter(row => looksLikeNonVenue(row.name));
  const stillUsed: string[] = [];

  for (const row of junkVenueList) {
    const [remaining] = await db
      .select({ eventId: event.eventId })
      .from(event)
      .where(eq(event.venueId, row.venueId))
      .limit(1);

    if (remaining) {
      stillUsed.push(`${row.venueId} "${row.name}"`);
      continue;
    }
    console.log(`  removing venue row ${row.venueId} "${row.name.slice(0, 60)}"`);
    if (!isDryRun) await db.delete(venue).where(eq(venue.venueId, row.venueId));
  }

  console.log(`\n${affectedList.length} event(s) cleared`);
  if (stillUsed.length > 0) {
    console.log(`${stillUsed.length} junk venue row(s) still referenced, left alone:\n  ${stillUsed.join('\n  ')}`);
  }

  await pgConnection.end({ timeout: 5 });
}

void main();
