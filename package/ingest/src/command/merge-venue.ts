import '../env.js';
import { db, event, sql as pgConnection, venue } from '@wheresthefx/db';
import { count, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { normalizeVenueName } from '../store/venue.js';
import { type VenueRow, bestName, classifyPair, metreApart } from '../store/venueMerge.js';

/**
 * Fold duplicate venue rows into one.
 *
 *   npx tsx package/ingest/src/command/merge-venue.ts [--dry-run]
 *
 * ## Why this exists
 *
 * The directory accumulated 54 redundant rows out of 361. Every spelling
 * of a venue that reached extraction became its own row, so "A. Bodespace"
 * had seven and "47 East" had four, each holding a slice of the events
 * and each drawing its own pin a few metres from the others.
 *
 * Matching prevents new ones — `VenueIndex` resolves aliases on the way
 * in — but nothing ever went back for the rows written before it.
 *
 * ## Destructive, so it is cautious
 *
 * The losing rows are deleted and their events repointed. Two guards:
 *
 * - Rows more than 150m apart are never merged whatever their names say.
 *   "Homebase" in Tondo and "HOMEBASE" in Makati are the same string and
 *   9km apart.
 * - Pairs that are co-located and similar but not demonstrably identical
 *   are printed under REVIEW and left alone. A tenant inside a larger
 *   venue is indistinguishable from a spelling variant by name alone, and
 *   folding "Greyhound Cafe, Ayala Triangle Gardens" into "Ayala Triangle
 *   Gardens" would quietly lose the more precise label.
 *
 * Losing names are kept as aliases, so a caption that spells the venue
 * the old way still resolves.
 */

interface Cluster {
  survivor: VenueRow;
  loserList: VenueRow[];
  name: string;
  aliasList: string[];
}

async function main(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');

  const rowList = await db
    .select({
      venueId: venue.venueId,
      name: venue.name,
      alias: venue.alias,
      lat: venue.lat,
      lng: venue.lng,
    })
    .from(venue);

  const countList = await db
    .select({ venueId: event.venueId, total: count() })
    .from(event)
    .where(isNotNull(event.venueId))
    .groupBy(event.venueId);
  const eventCount = new Map(countList.map(r => [r.venueId, r.total]));

  // Union-find, so a chain of pairwise matches collapses into one
  // cluster: "a.bodespace" matches "A. Bodespace" matches "a bode space"
  // even where the first and last would not match each other directly.
  const parent = new Map(rowList.map(r => [r.venueId, r.venueId]));
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) as number;
    return root;
  };

  const reviewList: string[] = [];

  for (let i = 0; i < rowList.length; i++) {
    for (let j = i + 1; j < rowList.length; j++) {
      const verdict = classifyPair(rowList[i], rowList[j]);
      if (verdict === 'same') parent.set(find(rowList[i].venueId), find(rowList[j].venueId));
      else if (verdict === 'review') {
        const distance = metreApart(rowList[i], rowList[j]);
        reviewList.push(
          `  ${rowList[i].venueId} "${rowList[i].name}"  <->  `
          + `${rowList[j].venueId} "${rowList[j].name}"  (${distance}m)`,
        );
      }
    }
  }

  const grouped = new Map<number, VenueRow[]>();
  for (const row of rowList) {
    const root = find(row.venueId);
    grouped.set(root, [...(grouped.get(root) ?? []), row]);
  }

  const clusterList: Cluster[] = [];
  for (const list of grouped.values()) {
    if (list.length < 2) continue;

    // The row with the most events survives, so the fewest events have
    // to be repointed. Which row survives and which name it carries are
    // separate questions.
    const survivor = [...list].sort((a, b) =>
      (eventCount.get(b.venueId) ?? 0) - (eventCount.get(a.venueId) ?? 0)
      || a.venueId - b.venueId,
    )[0];

    const name = bestName(list);
    const seen = new Set([normalizeVenueName(name)]);
    const aliasList: string[] = [];
    for (const row of list) {
      for (const candidate of [row.name, ...(row.alias ?? [])]) {
        const key = normalizeVenueName(candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        aliasList.push(candidate);
      }
    }

    clusterList.push({
      survivor,
      loserList: list.filter(r => r.venueId !== survivor.venueId),
      name,
      aliasList,
    });
  }

  console.log(
    `${rowList.length} venue(s), ${clusterList.length} cluster(s), `
    + `${clusterList.reduce((n, c) => n + c.loserList.length, 0)} row(s) to remove`
    + `${isDryRun ? ' (dry run)' : ''}\n`,
  );

  let movedEvent = 0;

  for (const cluster of clusterList) {
    const moving = cluster.loserList.reduce((n, r) => n + (eventCount.get(r.venueId) ?? 0), 0);
    movedEvent += moving;

    console.log(
      `  ${cluster.survivor.venueId} "${cluster.name}"`
      + `${cluster.survivor.name === cluster.name ? '' : `  (renamed from "${cluster.survivor.name}")`}`,
    );
    for (const loser of cluster.loserList) {
      console.log(`      absorbs ${loser.venueId} "${loser.name}" (${eventCount.get(loser.venueId) ?? 0} event)`);
    }

    if (isDryRun) continue;

    const loserIdList = cluster.loserList.map(r => r.venueId);

    // Order matters twice over. Events move first because the foreign
    // key refuses to drop a venue that still has them. The losing rows
    // then go before the survivor is renamed, because `venue.name` is
    // unique and the winning name is frequently held by a loser —
    // renaming first fails on "Quantum Skyview" already exists.
    await db.transaction(async (tx) => {
      await tx.update(event)
        .set({ venueId: cluster.survivor.venueId, updatedAt: new Date() })
        .where(inArray(event.venueId, loserIdList));

      await tx.delete(venue).where(inArray(venue.venueId, loserIdList));

      await tx.update(venue)
        .set({ name: cluster.name, alias: cluster.aliasList, updatedAt: new Date() })
        .where(eq(venue.venueId, cluster.survivor.venueId));

      // Every event on the surviving row carries the surviving name, so
      // the denormalised copy on `event` cannot drift from the directory.
      await tx.update(event)
        .set({ venueName: cluster.name, updatedAt: new Date() })
        .where(eq(event.venueId, cluster.survivor.venueId));
    });
  }

  console.log(`\n${movedEvent} event(s) repointed`);

  // Once an event is linked to a directory row, the row owns the name.
  // Without this the denormalised copy keeps whatever spelling the
  // caption used — "Bugsy's Sports Bar" against "Bugsy’s Sports Bar",
  // "Tipple & Slaw" against "Tipple and Slaw" — and the same venue reads
  // two ways depending on which query the page went through.
  const drifted = await db
    .select({ eventId: event.eventId, was: event.venueName, now: venue.name })
    .from(event)
    .innerJoin(venue, eq(event.venueId, venue.venueId))
    .where(sql`${event.venueName} is distinct from ${venue.name}`);

  for (const row of drifted) {
    if (!isDryRun) {
      await db.update(event)
        .set({ venueName: row.now, updatedAt: new Date() })
        .where(eq(event.eventId, row.eventId));
    }
  }
  console.log(`${drifted.length} event(s) re-synced to the directory spelling`);

  if (reviewList.length > 0) {
    console.log(
      `\n${reviewList.length} pair(s) left alone for a human call `
      + '(co-located, similar, not demonstrably the same place):\n'
      + reviewList.join('\n'),
    );
  }

  await pgConnection.end({ timeout: 5 });
}

void main();
