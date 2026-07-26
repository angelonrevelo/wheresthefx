import '../env.js';
import { db, event, sql as pgConnection } from '@wheresthefx/db';
import { isNotNull } from 'drizzle-orm';
import { titleSimilarity } from '../identity/hash.js';
import { isSameEvent } from '../store/event.js';

/**
 * Report events that are probably the same event twice.
 *
 *   npx tsx package/ingest/src/command/audit-duplicate.ts [--min 0.75]
 *
 * ## Why
 *
 * `saveEvent` dedups on a content hash, and falls back to a fuzzy tier
 * for the same event written differently. Both are deliberately
 * conservative: a wrong merge deletes an event silently, so the bar is
 * high and the residue is real.
 *
 * Re-extracting the recovered snapshot makes that residue concrete. An
 * event whose title, date and venue survive the new prompt unchanged
 * collides on the hash and updates in place. One whose title shifts —
 * and shifting titles is much of the point of a better prompt — lands as
 * a new row beside the legacy one, and the fuzzy tier only catches it
 * when they also share a date and a venue.
 *
 * A live scrape shows the same shape without any re-extraction: seven
 * rows appeared for one "Pabili Po" anniversary, each from a different
 * post about it, each titled differently.
 *
 * ## What it does not do
 *
 * It does not merge. `isSameEvent` — the predicate `saveEvent` uses — is
 * applied and reported separately from the looser similarity scan, so
 * the two questions stay distinct: "what did the pipeline's own rule
 * miss because the rows were never compared" against "what looks alike
 * to a person but not to the rule".
 */

const DEFAULT_MIN_SIMILARITY = 0.75;

/** Same-date groups larger than this are festivals, not duplicates. */
const MAX_GROUP_TO_SCAN = 400;

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main(): Promise<void> {
  const minSimilarity = Number(readArg('--min') ?? DEFAULT_MIN_SIMILARITY);

  const rowList = await db
    .select({
      eventId: event.eventId,
      title: event.title,
      eventDate: event.eventDate,
      venueName: event.venueName,
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

  interface Pair {
    a: typeof rowList[number];
    b: typeof rowList[number];
    similarity: number;
    caughtByRule: boolean;
  }

  const pairList: Pair[] = [];
  let skippedGroup = 0;

  for (const [, group] of byDate) {
    if (group.length < 2) continue;
    if (group.length > MAX_GROUP_TO_SCAN) {
      skippedGroup++;
      continue;
    }

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const similarity = titleSimilarity(group[i].title, group[j].title);
        if (similarity < minSimilarity) continue;
        pairList.push({
          a: group[i],
          b: group[j],
          similarity,
          caughtByRule: isSameEvent(group[i], group[j], similarity),
        });
      }
    }
  }

  const missed = pairList.filter(pair => !pair.caughtByRule);
  const legacyVsFresh = missed.filter(
    pair => (pair.a.sourcePostId === null) !== (pair.b.sourcePostId === null),
  );

  console.log(
    `${rowList.length} dated event(s), ${pairList.length} similar same-date pair(s) `
    + `at >=${minSimilarity}\n`
    + `  ${pairList.length - missed.length} would be merged by the pipeline's own rule\n`
    + `  ${missed.length} would not\n`
    + `  ${legacyVsFresh.length} of those pair a legacy row with a re-extracted one\n`,
  );

  if (skippedGroup > 0) {
    // Said out loud rather than silently dropped: a date with hundreds of
    // events is a festival, and reporting the truncation is the
    // difference between "clean" and "not looked at".
    console.log(`${skippedGroup} date(s) skipped for having over ${MAX_GROUP_TO_SCAN} events\n`);
  }

  // Legacy-versus-re-extracted first: that is the pair this run created
  // and the only one worth a decision today. The rest predate it.
  const ranked = [...missed].sort((x, y) => {
    const xIsResidue = (x.a.sourcePostId === null) !== (x.b.sourcePostId === null);
    const yIsResidue = (y.a.sourcePostId === null) !== (y.b.sourcePostId === null);
    if (xIsResidue !== yIsResidue) return xIsResidue ? -1 : 1;
    return y.similarity - x.similarity;
  });

  for (const pair of ranked.slice(0, 60)) {
    const tag = (pair.a.sourcePostId === null) !== (pair.b.sourcePostId === null)
      ? 'legacy/fresh'
      : 'same-source';
    console.log(
      `  ${pair.similarity.toFixed(2)} ${tag.padEnd(13)} ${pair.a.eventDate}\n`
      + `        ${pair.a.eventId} ${JSON.stringify(pair.a.title.slice(0, 58))} @ ${pair.a.venueName ?? '-'}\n`
      + `        ${pair.b.eventId} ${JSON.stringify(pair.b.title.slice(0, 58))} @ ${pair.b.venueName ?? '-'}`,
    );
  }

  if (missed.length > 60) console.log(`\n... and ${missed.length - 60} more`);

  await pgConnection.end({ timeout: 5 });
}

void main();
