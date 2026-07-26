import { fromRepoRoot } from '../env.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, sql as pgConnection, venue } from '@wheresthefx/db';
import { eq } from 'drizzle-orm';
import { normalizeVenueName } from '../store/venue.js';

/**
 * Merge the curated venue aliases into the venue table.
 *
 *   npx tsx package/ingest/src/command/merge-alias.ts [--dry-run]
 *
 * ## Why this exists
 *
 * Venue aliases were being kept in three places at once:
 *
 * 1. `known_venue.aliases` in the source database — seeded from a
 *    hand-written list, and already carried across by the re-ingest.
 * 2. `CANONICAL_ALIASES` in blead's `venue-normalizer.ts` — 42 more
 *    groups that only ever existed in code, in a repo that has since
 *    moved on to other work.
 * 3. Fuzzy matching in `venue-matcher.ts`, quietly overlapping both.
 *
 * Three sources for one fact is the inefficiency, not the data. The data
 * is good and mostly unobtainable otherwise: "Kia Theatre" is what New
 * Frontier Theater used to be called, "Big Dome" is what people actually
 * say, and no model reliably knows either.
 *
 * So the curated set moves into `venue.alias`, which `VenueIndex`
 * already reads, and the code layer stops being a second source. The
 * JSON lives in this repo rather than being read from blead, because
 * depending on that repo is the coupling that broke the pipeline before.
 */

const ALIAS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixture/venue-alias.json',
);

interface MergeCount {
  canonical: number;
  venueUpdated: number;
  aliasAdded: number;
  venueMissing: string[];
}

async function main(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');
  const aliasByCanonical: Record<string, string[]> = JSON.parse(
    readFileSync(fromRepoRoot(ALIAS_PATH), 'utf8'),
  );

  const count: MergeCount = {
    canonical: Object.keys(aliasByCanonical).length,
    venueUpdated: 0,
    aliasAdded: 0,
    venueMissing: [],
  };

  console.log(`merging ${count.canonical} curated venue alias group(s)${isDryRun ? ' (dry run)' : ''}\n`);

  const existingList = await db
    .select({ venueId: venue.venueId, name: venue.name, alias: venue.alias })
    .from(venue);

  // Match on the normalised name, so a canonical entry still finds its
  // row when the two differ only by punctuation or case.
  const byNormalizedName = new Map(
    existingList.map(row => [normalizeVenueName(row.name), row]),
  );

  for (const [canonicalName, curatedAliasList] of Object.entries(aliasByCanonical)) {
    const existing = byNormalizedName.get(normalizeVenueName(canonicalName));

    if (!existing) {
      count.venueMissing.push(canonicalName);
      continue;
    }

    // Union, not replace: the database copy may hold aliases this file
    // does not, and losing those would be a silent regression.
    const merged = [...(existing.alias ?? [])];
    let added = 0;
    for (const alias of curatedAliasList) {
      const isKnown = merged.some(
        known => normalizeVenueName(known) === normalizeVenueName(alias),
      );
      // An alias identical to the venue's own name carries no information.
      const isSelf = normalizeVenueName(alias) === normalizeVenueName(existing.name);
      if (isKnown || isSelf) continue;
      merged.push(alias);
      added++;
    }

    if (added === 0) continue;

    if (!isDryRun) {
      await db.update(venue)
        .set({ alias: merged, updatedAt: new Date() })
        .where(eq(venue.venueId, existing.venueId));
    }

    count.venueUpdated++;
    count.aliasAdded += added;
    console.log(`  ${existing.name}: +${added} (${merged.length} total)`);
  }

  console.log(
    `\n${count.venueUpdated} venue(s) updated, ${count.aliasAdded} alias(es) added`,
  );

  if (count.venueMissing.length > 0) {
    // Not created: a canonical name with no venue row is a name the
    // scraper has never actually seen, and inventing rows for them would
    // put unreferenced records in the directory.
    console.log(
      `\n${count.venueMissing.length} canonical name(s) had no venue row and were skipped:\n  ` +
      count.venueMissing.join('\n  '),
    );
  }

  await pgConnection.end({ timeout: 5 });
}

void main();
