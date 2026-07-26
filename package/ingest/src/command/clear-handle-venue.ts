import '../env.js';
import { db, event, sql as pgConnection } from '@wheresthefx/db';
import { eq, isNotNull } from 'drizzle-orm';
import { looksLikeHandle } from '../extractor/parse.js';

/**
 * Clear venue names that are Instagram handles rather than places.
 *
 *   npx tsx package/ingest/src/command/clear-handle-venue.ts [--dry-run]
 *
 * ## Why this exists
 *
 * `looksLikeHandle` now drops these at parse time, but rows written
 * before it existed still carry them: "electricstudioph",
 * "@hungry_neighborsph", "electric.sala". A handle is not a name anyone
 * would recognise on a map pin, and it seeds a junk row in the venue
 * directory that then attracts more events.
 *
 * ## What it deliberately does not touch
 *
 * Coordinates and addresses stay. Several of these rows geocoded from an
 * address stated in the caption ("Cubao Expo", "BGC Forbestown") rather
 * than from the handle, so the pin is sound even though the label is not.
 * A pin with an address and no name is worth more than no pin.
 *
 * It also does not invent replacement names. Some of these handles are
 * real places — the account behind "the_funroof" runs a rooftop bar in
 * Poblacion — but writing a guessed name into the directory is the same
 * mistake as geocoding a guessed location, and that one put fourteen
 * events at a coordinate nobody had verified. Curated handle-to-venue
 * mappings belong in `fixture/venue-alias.json`, added deliberately.
 *
 * The decision is shared with the pipeline rather than re-expressed as
 * SQL, so a backfill cannot drift from what the extractor now does.
 */

async function main(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');

  const candidateList = await db
    .select({
      eventId: event.eventId,
      title: event.title,
      venueName: event.venueName,
      venueId: event.venueId,
      sourceUsername: event.sourceUsername,
      venueLat: event.venueLat,
    })
    .from(event)
    .where(isNotNull(event.venueName));

  const affectedList = candidateList.filter(
    row => row.venueName && looksLikeHandle(row.venueName, row.sourceUsername),
  );

  console.log(
    `${candidateList.length} event(s) with a venue name, `
    + `${affectedList.length} holding a handle${isDryRun ? ' (dry run)' : ''}\n`,
  );

  for (const row of affectedList) {
    const keptPin = row.venueLat !== null ? ' [pin kept]' : '';
    console.log(`  ${row.eventId}  ${row.venueName}  <- ${row.title}${keptPin}`);

    if (isDryRun) continue;

    // venue_id goes too: it points at a venue row named after the same
    // handle, so leaving it would surface the label through the join.
    await db.update(event)
      .set({ venueName: null, venueId: null, updatedAt: new Date() })
      .where(eq(event.eventId, row.eventId));
  }

  console.log(`\n${affectedList.length} event(s) ${isDryRun ? 'would be' : ''} cleared`);

  // The venue rows themselves are left in place and simply unreferenced.
  // Deleting them belongs with the duplicate-venue merge, which is one
  // destructive pass over the directory rather than a side effect here.
  await pgConnection.end({ timeout: 5 });
}

void main();
