import '../env.js';
import { db, event, sql as pgConnection, venue } from '@wheresthefx/db';
import { eq, isNotNull } from 'drizzle-orm';
import { looksLikeHandle } from '../extractor/parse.js';

/**
 * Repair venue names that are Instagram handles rather than places.
 *
 *   npx tsx package/ingest/src/command/clear-handle-venue.ts [--dry-run]
 *
 * ## Why this exists
 *
 * `looksLikeHandle` now drops these at parse time, but rows written
 * before it existed still carry them: "electricstudioph",
 * "@hungry_neighborsph", "electric.sala". A handle is not a name anyone
 * would recognise on a map pin.
 *
 * ## Adopt before clearing
 *
 * `event.venue_name` and `event.venue_id` disagree more often than
 * expected. Twelve events hold a handle in `venue_name` while their
 * `venue_id` points at a properly named row — "Electric Sala", "The
 * Funroof", "A. Bodespace" — because the venue matcher cleaned the name
 * on the way into the directory and nothing wrote it back.
 *
 * So the linked name is adopted wherever there is one, and the name is
 * only cleared when the venue row is missing or is itself named after a
 * handle. Detaching these from their venue would have cut eighteen
 * events loose from one row to fix a label on three of them.
 *
 * Coordinates and addresses stay in every case. Several of these
 * geocoded from an address stated in the caption ("Cubao Expo", "BGC
 * Forbestown") rather than from the handle, so the pin is sound even
 * where the label is not, and a pin with an address and no name is worth
 * more than no pin.
 *
 * No replacement name is invented. Some of these handles are real places
 * with no venue row to adopt from, but writing a guessed name into the
 * directory is the same mistake as geocoding a guessed location, and
 * that one put fourteen events at a coordinate nobody had verified.
 * Curated handle-to-venue mappings belong in `fixture/venue-alias.json`,
 * added deliberately.
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
      linkedName: venue.name,
    })
    .from(event)
    .leftJoin(venue, eq(event.venueId, venue.venueId))
    .where(isNotNull(event.venueName));

  const affectedList = candidateList.filter(
    row => row.venueName && looksLikeHandle(row.venueName, row.sourceUsername),
  );

  console.log(
    `${candidateList.length} event(s) with a venue name, `
    + `${affectedList.length} holding a handle${isDryRun ? ' (dry run)' : ''}\n`,
  );

  let adopted = 0;
  let cleared = 0;

  for (const row of affectedList) {
    // A linked row that is itself named after a handle is no better than
    // the string on the event, so it is not worth adopting or keeping.
    const isLinkedNameUsable = Boolean(
      row.linkedName && !looksLikeHandle(row.linkedName, row.sourceUsername),
    );

    const value = isLinkedNameUsable
      ? { venueName: row.linkedName, updatedAt: new Date() }
      : { venueName: null, venueId: null, updatedAt: new Date() };

    if (isLinkedNameUsable) adopted++;
    else cleared++;

    console.log(
      `  ${row.eventId}  ${row.venueName} -> ${value.venueName ?? '(none)'}  ${row.title}`,
    );

    if (isDryRun) continue;
    await db.update(event).set(value).where(eq(event.eventId, row.eventId));
  }

  console.log(`\n${adopted} adopted the linked venue name, ${cleared} cleared`);

  // Venue rows left unreferenced are not deleted here. That belongs with
  // the duplicate-venue merge, which is one destructive pass over the
  // directory rather than a side effect of a label repair.
  await pgConnection.end({ timeout: 5 });
}

void main();
