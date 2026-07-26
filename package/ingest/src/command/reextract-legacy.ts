import { fromRepoRoot } from '../env.js';
import Database from 'better-sqlite3';
import { sql as pgConnection } from '@wheresthefx/db';
import { readBackendConfig } from '../extractor/backend.js';
import { extractEvent } from '../extractor/extract.js';
import { prefilterCaption } from '../extractor/prefilter.js';
import { assignReviewTier } from '../identity/hash.js';
import { PROMPT_VERSION } from '../prompt/extraction.js';
import { CostMeter } from '../store/cost.js';
import { saveEvent } from '../store/event.js';
import { savePost } from '../store/post.js';
import { loadVenueIndex, loadVenueNameList } from '../store/venue.js';

/**
 * Re-extract the recovered snapshot with the current prompt.
 *
 *   npx tsx package/ingest/src/command/reextract-legacy.ts [--limit N] [--dry-run]
 *
 * ## Why
 *
 * 2,226 events in the directory were carried across from blead's SQLite
 * without re-running extraction, so they hold whatever the old Gemini
 * prompt produced. They have never seen the weekday fix, the multi-range
 * date rule, the free-with-consumable rule, the venue-is-the-building
 * rule, or the prompt-injection split. Every venue defect cleaned up this
 * week — the bare "Activity Center", the caption fragment in venueName,
 * the Instagram handles — came from that population and none from a
 * fresh scrape.
 *
 * The captions were not carried across either: those events have a null
 * `source_post_id`, and `source_post` holds only the 1,101 posts the live
 * scraper has fetched. They still exist in `ig-events.db` on the VPS,
 * 5,567 of them, which is what makes this possible at all.
 *
 * ## Cost
 *
 * Priced per run rather than assumed. `--limit` exists so a pilot can
 * measure the real per-post cost against the real captions before the
 * full set is committed to.
 *
 * ## Duplicates
 *
 * Re-extraction writes through `saveEvent`, so an event whose title, date
 * and venue survive unchanged collides on `event_hash` and takes the
 * score-based update path. One that changes lands as a new row beside the
 * legacy one, and the fuzzy tier catches it only when they share a date
 * and a venue. That residue is real and is why the pilot is worth
 * reading before the rest runs.
 */

interface SqlitePost {
  shortcode: string;
  post_url: string | null;
  post_type: string | null;
  caption: string | null;
  posted_at: string | null;
  image_url_list: string | null;
  likes_count: number | null;
  comments_count: number | null;
  username: string | null;
  venue_type: string | null;
  category_distribution: string | null;
  typical_hours: string | null;
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');
  const limit = Number(readArg('--limit') ?? '0') || null;

  const dbPath = fromRepoRoot(process.env.BLEAD_DB_PATH ?? './data/ig-events.db');
  const sqlite = new Database(dbPath, { readonly: true });

  const postList = sqlite.prepare(`
    SELECT p.shortcode, p.post_url, p.post_type, p.caption, p.posted_at,
           p.image_url_list, p.likes_count, p.comments_count,
           a.username, a.venue_type, a.category_distribution, a.typical_hours
    FROM ig_post p
    LEFT JOIN ig_account a ON a.ig_account_id = p.ig_account_id
    WHERE p.caption IS NOT NULL AND length(p.caption) > 20
    ORDER BY p.posted_at DESC
    ${limit ? `LIMIT ${limit}` : ''}
  `).all() as SqlitePost[];

  const config = readBackendConfig();
  const meter = new CostMeter(config.model);
  const venueIndex = await loadVenueIndex();
  const knownVenueNameList = venueIndex.size > 0 ? await loadVenueNameList() : [];

  const count = {
    read: postList.length,
    prefiltered: 0,
    extracted: 0,
    event: 0,
    failed: 0,
  };

  console.log(
    `${postList.length} captioned post(s) from ${dbPath}\n`
    + `model ${config.model}, prompt ${PROMPT_VERSION}${isDryRun ? ' (dry run)' : ''}\n`,
  );

  for (const post of postList) {
    if (!post.caption) continue;

    // The prefilter is anti-signal only: it drops what is demonstrably
    // not an event rather than guessing at what is.
    if (!prefilterCaption(post.caption).isWorthExtracting) {
      count.prefiltered++;
      continue;
    }

    try {
      const outcome = await extractEvent({
        caption: post.caption,
        username: post.username,
        postedAt: post.posted_at ? new Date(post.posted_at) : null,
        knownVenueList: knownVenueNameList,
        venueProfile: {
          venueType: post.venue_type,
          categoryDistribution: parseJson(post.category_distribution),
          typicalHours: parseJson(post.typical_hours),
          recurringEventList: null,
        },
      }, { config });

      meter.record(outcome.usage);
      count.extracted++;

      if (isDryRun) {
        if (outcome.result.isEvent) count.event++;
        continue;
      }

      // blead stored the images as a JSON array; the first is the one
      // the card renders.
      const imageUrlList = parseJson<string[]>(post.image_url_list) ?? [];
      const imageUrl = imageUrlList[0] ?? null;

      const sourcePostId = await savePost({
        accountId: null,
        shortcode: post.shortcode,
        postUrl: post.post_url ?? `https://www.instagram.com/p/${post.shortcode}/`,
        postType: post.post_type ?? 'unknown',
        caption: post.caption,
        postedAt: post.posted_at ? new Date(post.posted_at) : null,
        imageUrl,
        imageUrlList,
        likeCount: post.likes_count ?? 0,
        commentCount: post.comments_count ?? 0,
        isEvent: outcome.result.isEvent,
        rawExtraction: outcome.result,
        extractionMethod: outcome.provenance.method,
        extractionModel: outcome.provenance.model,
        promptVersion: outcome.provenance.promptVersion,
        extractedAt: outcome.provenance.extractedAt,
        aiConfidence: outcome.result.confidence,
      });

      const result = outcome.result;
      if (!result.isEvent || !result.eventTitle || !result.eventDate) continue;

      const matched = venueIndex.match(result.venueName);
      await saveEvent({
        title: result.eventTitle,
        eventDate: result.eventDate,
        eventEndDate: result.eventEndDate,
        eventTime: result.eventTime,
        endTime: result.endTime,
        description: result.description,
        venueId: matched?.venueId ?? null,
        venueName: result.venueName,
        venueAddress: result.venueAddress,
        venueLat: matched?.lat ?? null,
        venueLng: matched?.lng ?? null,
        locationStatus: result.locationStatus,
        isFree: result.isFree,
        price: result.price,
        priceMin: result.priceMin,
        priceMax: result.priceMax,
        priceNote: result.priceNote,
        signupUrl: result.signupUrl,
        category: result.category,
        artist: result.artistList,
        availabilityStatus: result.availabilityStatus ?? 'available',
        isRecurring: result.isRecurring,
        recurrencePattern: result.recurrencePattern,
        confidence: result.confidence,
        reviewTier: assignReviewTier(result.confidence, {
          title: result.eventTitle,
          eventDate: result.eventDate,
          eventTime: result.eventTime,
          venueName: result.venueName,
        }),
        imageUrl,
        sourceUsername: post.username,
        sourcePostId,
        sourceAccountId: null,
        subEventList: result.subEventList?.map(entry => ({
          title: entry.title,
          eventDate: entry.date,
          eventTime: entry.time,
          endTime: entry.endTime,
          description: entry.description,
        })) ?? null,
      });
      count.event++;
    } catch (error) {
      count.failed++;
      console.log(`  ! ${post.shortcode}: ${(error as Error).message.slice(0, 100)}`);
    }

    if (count.extracted % 25 === 0 && count.extracted > 0) {
      console.log(
        `  ${count.extracted}/${postList.length - count.prefiltered} extracted, `
        + `${count.event} event(s), $${meter.totalCost.toFixed(4)}`,
      );
    }
  }

  sqlite.close();

  const cost = meter.totalCost;
  const perPost = count.extracted > 0 ? cost / count.extracted : 0;

  console.log(
    `\nread ${count.read}, prefiltered ${count.prefiltered}, extracted ${count.extracted}, `
    + `events ${count.event}, failed ${count.failed}\n`
    + `cost $${cost.toFixed(4)} ($${perPost.toFixed(5)}/post)`,
  );

  // The number that matters for deciding whether to run the rest.
  if (limit) {
    console.log(`projected for all 5,567 captioned posts: $${(perPost * 5567).toFixed(2)}`);
  }

  await pgConnection.end({ timeout: 5 });
}

void main();
