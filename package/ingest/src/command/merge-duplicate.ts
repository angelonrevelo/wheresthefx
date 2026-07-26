import '../env.js';
import { db, event, savedEvent, sql as pgConnection, subEvent } from '@wheresthefx/db';
import { eq, isNotNull } from 'drizzle-orm';
import { titleSimilarity } from '../identity/hash.js';
import { looksLikeNonVenue } from '../extractor/parse.js';
import { isSameEvent } from '../store/event.js';

/**
 * Fold events the merge rule accepts but that were written apart.
 *
 *   npx tsx package/ingest/src/command/merge-duplicate.ts [--dry-run]
 *
 * ## Why
 *
 * `saveEvent` compares each incoming event against what is already there,
 * so duplicates are normally prevented rather than cleaned up. Two things
 * defeat that:
 *
 * - The rule changed after the rows were written. Legacy events carry a
 *   null `source_account_id`, so the venue-less branch could never match
 *   one against its re-extracted twin until the comparison learned to
 *   fall back to `source_username`. Everything written before that fix
 *   sits in the database unmerged.
 * - Two rows can each be compared against a third and never against each
 *   other, depending on the order they arrived.
 *
 * ## Only what the pipeline itself would merge
 *
 * `isSameEvent` is the arbiter — the same predicate `saveEvent` uses, not
 * a looser one written for cleanup. If it says no, the rows stay. That
 * keeps one definition of "the same event" in the codebase rather than
 * two that drift, and it means this pass can never merge something the
 * live pipeline would have kept apart.
 *
 * `audit-duplicate` reports the wider set that only a person can judge.
 *
 * ## Bookmarks survive
 *
 * A saved event is repointed at the surviving row, not deleted with the
 * losing one. The previous dedup implementation hard-deleted and let the
 * cascade take bookmarks with it, which is a user silently losing
 * something they asked to keep.
 */

/** Same-date groups larger than this are festivals, not duplicates. */
const MAX_GROUP_TO_SCAN = 400;

async function main(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');

  const rowList = await db
    .select({
      eventId: event.eventId,
      title: event.title,
      eventDate: event.eventDate,
      venueName: event.venueName,
      venueLat: event.venueLat,
      sourceAccountId: event.sourceAccountId,
      sourceUsername: event.sourceUsername,
      sourcePostId: event.sourcePostId,
      completenessScore: event.completenessScore,
    })
    .from(event)
    .where(isNotNull(event.eventDate));

  const byDate = new Map<string, typeof rowList>();
  for (const row of rowList) {
    byDate.set(row.eventDate, [...(byDate.get(row.eventDate) ?? []), row]);
  }

  // Union-find so three spellings of one event collapse to a single
  // survivor rather than merging pairwise into a chain.
  const parent = new Map(rowList.map(row => [row.eventId, row.eventId]));
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) as number;
    return root;
  };

  let skippedGroup = 0;

  for (const group of byDate.values()) {
    if (group.length < 2) continue;
    if (group.length > MAX_GROUP_TO_SCAN) {
      skippedGroup++;
      continue;
    }
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const similarity = titleSimilarity(group[i].title, group[j].title);
        if (!isSameEvent(group[i], group[j], similarity)) continue;
        parent.set(find(group[i].eventId), find(group[j].eventId));
      }
    }
  }

  const cluster = new Map<number, typeof rowList>();
  for (const row of rowList) {
    const root = find(row.eventId);
    cluster.set(root, [...(cluster.get(root) ?? []), row]);
  }

  const mergeList = [...cluster.values()].filter(list => list.length > 1);
  const removed = mergeList.reduce((total, list) => total + list.length - 1, 0);

  console.log(
    `${rowList.length} dated event(s), ${mergeList.length} cluster(s), `
    + `${removed} row(s) to remove${isDryRun ? ' (dry run)' : ''}\n`,
  );

  if (skippedGroup > 0) {
    console.log(`${skippedGroup} date(s) skipped for holding over ${MAX_GROUP_TO_SCAN} events\n`);
  }

  let movedBookmark = 0;

  for (const list of mergeList) {
    // A usable venue name outranks everything, because the completeness
    // score cannot tell a real venue from a junk string of the same
    // length. Left to the score alone this kept "Cupid's Corner
    // @thecornerhouseph" and dropped the row that said "The Corner
    // House". Then best-described, then a placed row over an unplaced
    // one: losing a coordinate takes the event off the map.
    const venueRank = (row: typeof list[number]) =>
      row.venueName && !looksLikeNonVenue(row.venueName) ? 1 : 0;

    const survivor = [...list].sort((a, b) =>
      venueRank(b) - venueRank(a)
      || (b.completenessScore ?? 0) - (a.completenessScore ?? 0)
      || Number(b.venueLat !== null) - Number(a.venueLat !== null)
      || a.eventId - b.eventId,
    )[0];
    const loserList = list.filter(row => row.eventId !== survivor.eventId);

    console.log(`  keep ${survivor.eventId} ${JSON.stringify(survivor.title.slice(0, 56))} @ ${survivor.venueName ?? '-'}`);
    for (const loser of loserList) {
      console.log(`    drop ${loser.eventId} ${JSON.stringify(loser.title.slice(0, 56))} @ ${loser.venueName ?? '-'}`);
    }

    if (isDryRun) continue;

    for (const loser of loserList) {
      await db.transaction(async (tx) => {
        const bookmarkList = await tx
          .select({ savedEventId: savedEvent.savedEventId })
          .from(savedEvent)
          .where(eq(savedEvent.eventId, loser.eventId));

        for (const bookmark of bookmarkList) {
          // Repointed one at a time: the survivor may already be saved by
          // the same account, and the unique constraint would reject a
          // blanket update.
          try {
            await tx.update(savedEvent)
              .set({ eventId: survivor.eventId })
              .where(eq(savedEvent.savedEventId, bookmark.savedEventId));
            movedBookmark++;
          } catch {
            await tx.delete(savedEvent).where(eq(savedEvent.savedEventId, bookmark.savedEventId));
          }
        }

        await tx.delete(subEvent).where(eq(subEvent.eventId, loser.eventId));
        await tx.delete(event).where(eq(event.eventId, loser.eventId));
      });
    }
  }

  console.log(
    `\n${removed} event(s) ${isDryRun ? 'would be ' : ''}removed, `
    + `${movedBookmark} bookmark(s) repointed`,
  );

  await pgConnection.end({ timeout: 5 });
}

void main();
