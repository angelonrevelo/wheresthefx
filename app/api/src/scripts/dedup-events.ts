/**
 * Event Deduplication Script (v2 — Fuzzy)
 *
 * Two-pass deduplication:
 *
 * Pass 1 — Exact title match:
 *   Normalize titles, group by (normalized_title, event_date),
 *   keep highest completeness_score.
 *
 * Pass 2 — Fuzzy venue+date match:
 *   Group remaining events by normalized_venue.
 *   Within each group, cluster events whose titles share ≥35% of words
 *   (Jaccard similarity) AND have overlapping date ranges.
 *   Keep the best-scored event per cluster.
 *
 * Usage:
 *   npx tsx src/scripts/dedup-events.ts          # Dry run (default)
 *   npx tsx src/scripts/dedup-events.ts --apply   # Actually delete duplicates
 *
 * Also exported as `runDedup(sql)` for use in the ingest pipeline.
 */

import 'dotenv/config';
import postgres from 'postgres';

// ────────────────────────────────────────────────────────────────────────────
// Normalization helpers
// ────────────────────────────────────────────────────────────────────────────

/** Normalize title for exact-match dedup */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/^the\s+/i, '')
    .replace(/\s+/g, ' ')
    .replace(/['']/g, "'")
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/\s+at\s+.*$/i, '')       // Strip "at <venue>"
    .replace(/\s+by\s+@?\w+.*$/i, '')  // Strip "by @account"
    .trim();
}

/** Normalize venue name for grouping */
function normalizeVenue(venue: string | null): string {
  if (!venue) return '__no_venue__';
  return venue
    .toLowerCase()
    .trim()
    .replace(/^the\s+/i, '')
    .replace(/\s+/g, ' ')
    .replace(/,\s*.*$/, '')            // Strip everything after comma ("The Bench Tower, BGC" → "the bench tower")
    .replace(/\s+(activity center|mall|lifestyle center|building)$/i, '') // Strip common suffixes
    .trim();
}

/** Extract meaningful words for fuzzy comparison */
function titleWords(title: string): Set<string> {
  const stopwords = new Set([
    'the', 'a', 'an', 'at', 'in', 'on', 'by', 'for', 'of', 'and', '&', '+',
    'x', 'with', 'ft', 'feat', 'vs', 'to', 'from', 'is', 'are', 'was',
  ]);
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !stopwords.has(w))
  );
}

/** Jaccard similarity: |A ∩ B| / |A ∪ B| */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ────────────────────────────────────────────────────────────────────────────

interface EventRow {
  id: number;
  title: string;
  event_date: string;
  event_end_date: string | null;
  venue_name: string | null;
  source_username: string | null;
  completeness_score: number | null;
  confidence: number | null;
  event_hash: string | null;
  source_post_id: number | null;
  created_at: string;
}

/** Check if two events have overlapping date ranges */
function datesOverlap(a: EventRow, b: EventRow): boolean {
  const aStart = a.event_date;
  const aEnd = a.event_end_date || a.event_date;
  const bStart = b.event_date;
  const bEnd = b.event_end_date || b.event_date;
  return aStart <= bEnd && bStart <= aEnd;
}

function scoreSorter(a: EventRow, b: EventRow): number {
  const scoreA = Number(a.completeness_score) || 0;
  const scoreB = Number(b.completeness_score) || 0;
  if (scoreB !== scoreA) return scoreB - scoreA;
  const confA = Number(a.confidence) || 0;
  const confB = Number(b.confidence) || 0;
  if (confB !== confA) return confB - confA;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

// ────────────────────────────────────────────────────────────────────────────
// Core dedup function (importable)
// ────────────────────────────────────────────────────────────────────────────

export interface DedupResult {
  totalEvents: number;
  exactDuplicates: number;
  fuzzyDuplicates: number;
  deleted: number;
  remaining: number;
}

/**
 * Run two-pass deduplication on the event table.
 * Always applies deletions (no dry-run mode when called programmatically).
 */
export async function runDedup(conn: ReturnType<typeof postgres>): Promise<DedupResult> {
  const events: EventRow[] = await conn`
    SELECT id, title, event_date::text, event_end_date::text, venue_name, source_username,
           completeness_score, confidence, event_hash, source_post_id,
           created_at::text
    FROM event
    WHERE event_status = 'confirmed'
    ORDER BY event_date, title
  `;

  const idsToDelete = new Set<number>();

  // Pass 1: Exact normalized title + date
  const exactGroups = new Map<string, EventRow[]>();
  for (const row of events) {
    const key = `${normalizeTitle(row.title)}||${row.event_date}`;
    if (!exactGroups.has(key)) exactGroups.set(key, []);
    exactGroups.get(key)!.push(row);
  }

  let pass1Count = 0;
  for (const [_, group] of exactGroups) {
    if (group.length <= 1) continue;
    group.sort(scoreSorter);
    for (const dupe of group.slice(1)) {
      idsToDelete.add(dupe.id);
      pass1Count++;
    }
  }

  // Pass 2: Fuzzy venue + overlapping date
  const remaining = events.filter(e => !idsToDelete.has(e.id));
  const venueGroups = new Map<string, EventRow[]>();
  for (const row of remaining) {
    const key = normalizeVenue(row.venue_name);
    if (!venueGroups.has(key)) venueGroups.set(key, []);
    venueGroups.get(key)!.push(row);
  }

  const JACCARD_THRESHOLD = 0.35;
  let pass2Count = 0;

  for (const [_, group] of venueGroups) {
    if (group.length <= 1) continue;

    const assigned = new Set<number>();
    for (let i = 0; i < group.length; i++) {
      if (assigned.has(group[i].id)) continue;
      const cluster: EventRow[] = [group[i]];
      assigned.add(group[i].id);
      const wordsI = titleWords(group[i].title);

      for (let j = i + 1; j < group.length; j++) {
        if (assigned.has(group[j].id)) continue;
        if (!datesOverlap(group[i], group[j])) continue;
        const wordsJ = titleWords(group[j].title);
        if (jaccardSimilarity(wordsI, wordsJ) >= JACCARD_THRESHOLD) {
          cluster.push(group[j]);
          assigned.add(group[j].id);
        }
      }

      if (cluster.length > 1) {
        cluster.sort(scoreSorter);
        for (const dupe of cluster.slice(1)) {
          idsToDelete.add(dupe.id);
          pass2Count++;
        }
      }
    }
  }

  // Apply deletions
  if (idsToDelete.size > 0) {
    const idArr = [...idsToDelete];
    await conn`DELETE FROM sub_event WHERE event_id = ANY(${idArr})`;
    await conn`DELETE FROM saved_event WHERE event_id = ANY(${idArr})`;
    await conn`DELETE FROM event WHERE id = ANY(${idArr})`;
  }

  return {
    totalEvents: events.length,
    exactDuplicates: pass1Count,
    fuzzyDuplicates: pass2Count,
    deleted: idsToDelete.size,
    remaining: events.length - idsToDelete.size,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// CLI entry point (with verbose logging + dry-run support)
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const sql = postgres(DATABASE_URL);
  const APPLY = process.argv.includes('--apply');

  console.log(`\n🔍 Event Deduplication v2 (${APPLY ? '⚠️  APPLY MODE' : '🔒 DRY RUN'})\n`);

  const events: EventRow[] = await sql`
    SELECT id, title, event_date::text, event_end_date::text, venue_name, source_username,
           completeness_score, confidence, event_hash, source_post_id,
           created_at::text
    FROM event
    WHERE event_status = 'confirmed'
    ORDER BY event_date, title
  `;

  console.log(`📊 Total events: ${events.length}`);

  const idsToDelete = new Set<number>();

  // Pass 1: Exact
  console.log('\n═══ Pass 1: Exact Title Match ═══\n');
  const exactGroups = new Map<string, EventRow[]>();
  for (const row of events) {
    const key = `${normalizeTitle(row.title)}||${row.event_date}`;
    if (!exactGroups.has(key)) exactGroups.set(key, []);
    exactGroups.get(key)!.push(row);
  }

  let pass1Count = 0;
  for (const [_, group] of exactGroups) {
    if (group.length <= 1) continue;
    group.sort(scoreSorter);
    const keeper = group[0];
    console.log(`  📌 "${keeper.title}" (${keeper.event_date})`);
    console.log(`     KEEP: id=${keeper.id} score=${keeper.completeness_score} @${keeper.source_username}`);
    for (const dupe of group.slice(1)) {
      console.log(`     DEL:  id=${dupe.id} score=${dupe.completeness_score} @${dupe.source_username}`);
      idsToDelete.add(dupe.id);
      pass1Count++;
    }
    console.log('');
  }
  console.log(`Pass 1 found: ${pass1Count} duplicates\n`);

  // Pass 2: Fuzzy
  console.log('═══ Pass 2: Fuzzy Venue+Date Match ═══\n');
  const remaining = events.filter(e => !idsToDelete.has(e.id));
  const venueGroups = new Map<string, EventRow[]>();
  for (const row of remaining) {
    const key = normalizeVenue(row.venue_name);
    if (!venueGroups.has(key)) venueGroups.set(key, []);
    venueGroups.get(key)!.push(row);
  }

  const JACCARD_THRESHOLD = 0.35;
  let pass2Count = 0;

  for (const [_, group] of venueGroups) {
    if (group.length <= 1) continue;
    const assigned = new Set<number>();

    for (let i = 0; i < group.length; i++) {
      if (assigned.has(group[i].id)) continue;
      const cluster: EventRow[] = [group[i]];
      assigned.add(group[i].id);
      const wordsI = titleWords(group[i].title);

      for (let j = i + 1; j < group.length; j++) {
        if (assigned.has(group[j].id)) continue;
        if (!datesOverlap(group[i], group[j])) continue;
        const wordsJ = titleWords(group[j].title);
        if (jaccardSimilarity(wordsI, wordsJ) >= JACCARD_THRESHOLD) {
          cluster.push(group[j]);
          assigned.add(group[j].id);
        }
      }

      if (cluster.length > 1) {
        cluster.sort(scoreSorter);
        const keeper = cluster[0];
        console.log(`  🔗 Venue "${keeper.venue_name}" (${keeper.event_date})`);
        console.log(`     KEEP: id=${keeper.id} "${keeper.title}" score=${keeper.completeness_score}`);
        for (const dupe of cluster.slice(1)) {
          const sim = jaccardSimilarity(titleWords(keeper.title), titleWords(dupe.title));
          console.log(`     DEL:  id=${dupe.id} "${dupe.title}" score=${dupe.completeness_score} (sim=${sim.toFixed(2)})`);
          idsToDelete.add(dupe.id);
          pass2Count++;
        }
        console.log('');
      }
    }
  }
  console.log(`Pass 2 found: ${pass2Count} fuzzy duplicates\n`);

  // Summary
  const totalToDelete = idsToDelete.size;
  console.log(`\n📊 Summary: ${totalToDelete} total duplicates (${pass1Count} exact + ${pass2Count} fuzzy)`);
  console.log(`   ${events.length} → ${events.length - totalToDelete} events\n`);

  if (!APPLY) {
    console.log('🔒 DRY RUN — no changes made. Run with --apply to delete duplicates.\n');
    await sql.end();
    return;
  }

  console.log('⚠️  Applying deletions...');
  const idArr = [...idsToDelete];

  const subResult = await sql`DELETE FROM sub_event WHERE event_id = ANY(${idArr})`;
  console.log(`   🗑️  Deleted ${subResult.count} sub_event`);

  const savedResult = await sql`DELETE FROM saved_event WHERE event_id = ANY(${idArr})`;
  console.log(`   🗑️  Deleted ${savedResult.count} saved_event`);

  const eventResult = await sql`DELETE FROM event WHERE id = ANY(${idArr})`;
  console.log(`   🗑️  Deleted ${eventResult.count} duplicate events`);

  const [remaining2] = await sql`SELECT count(*) as cnt FROM event WHERE event_status = 'confirmed'`;
  console.log(`\n✅ Done! ${remaining2.cnt} confirmed events remaining.\n`);

  await sql.end();
}

// Only run main() when executed directly (not imported)
const isDirectRun = process.argv[1]?.includes('dedup-events');
if (isDirectRun) {
  main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
}
