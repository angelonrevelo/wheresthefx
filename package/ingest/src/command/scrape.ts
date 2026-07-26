import 'dotenv/config';
import { sql as pgConnection } from '@wheresthefx/db';
import { createStealthSession, jitteredDelay } from '../scraper/stealth.js';
import { InstagramBlockedError, fetchRecentPost, resolveUserId } from '../scraper/instagram.js';
import { extractEvent, ExtractorAuthError } from '../extractor/gemini.js';
import { assignReviewTier } from '../identity/hash.js';
import { saveEvent } from '../store/event.js';
import { listScrapeTarget, markAccountScraped } from '../store/account.js';
import { loadVenueIndex } from '../store/venue.js';
import { savePost } from '../store/post.js';
import {
  completeSyncRun, emptyCount, failSyncRun, startSyncRun, type SyncCount,
} from '../store/sync.js';

/**
 * The live pipeline: scrape → extract → store.
 *
 *   npx tsx package/ingest/src/command/scrape.ts [options]
 *
 *   --limit N        accounts this run (default 25)
 *   --max-post N     posts per account (default 20)
 *   --account NAME   one account, ignoring staleness
 *   --headed         show the browser
 *   --dry-run        scrape and extract, write nothing
 *
 * ## Pacing
 *
 * Deliberately slow. Instagram tolerates a steady trickle and blocks
 * bursts, so the default spacing is ~5s between accounts and ~2s between
 * extractions. A full pass over 212 accounts is meant to take tens of
 * minutes, not minutes.
 */

interface Option {
  limit: number;
  maxPost: number;
  account: string | null;
  isHeaded: boolean;
  isDryRun: boolean;
}

function parseOption(argv: string[]): Option {
  const valueFor = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
  };
  return {
    limit: Number(valueFor('--limit') ?? 25),
    maxPost: Number(valueFor('--max-post') ?? 20),
    account: valueFor('--account'),
    isHeaded: argv.includes('--headed'),
    isDryRun: argv.includes('--dry-run'),
  };
}

const DELAY_BETWEEN_ACCOUNT_MS = 5000;
const DELAY_BETWEEN_EXTRACTION_MS = 2000;

/** Consecutive empty accounts that indicate a block rather than quiet feeds. */
const EMPTY_ACCOUNT_ABORT_THRESHOLD = 8;

async function main(): Promise<void> {
  const option = parseOption(process.argv.slice(2));
  const count: SyncCount = emptyCount();

  const target = option.account
    ? [{
        sourceAccountId: -1,
        username: option.account,
        igUserId: null,
        venueType: null,
        categoryDistribution: null,
        typicalHours: null,
        recurringEvent: null,
      }]
    : await listScrapeTarget(option.limit);

  if (target.length === 0) {
    console.log('No accounts due for a scrape.');
    await pgConnection.end({ timeout: 5 });
    return;
  }

  console.log(`Scraping ${target.length} account(s), up to ${option.maxPost} posts each.`);
  if (option.isDryRun) console.log('Dry run: nothing will be written.\n');

  const venueIndex = await loadVenueIndex();
  const knownVenueNameList = venueIndex.size > 0 ? await loadVenueNameList() : [];

  const syncLogId = option.isDryRun ? -1 : await startSyncRun();

  const session = await createStealthSession({
    headless: !option.isHeaded,
    proxyUrl: process.env.IG_PROXY_URL,
    sessionPath: process.env.IG_SESSION_PATH ?? 'data/session/ig-session.json',
  });

  console.log(`Session: ${session.isAuthenticated ? 'authenticated' : 'anonymous (public profiles only)'}\n`);

  let consecutiveEmpty = 0;

  try {
    // Establishing an origin first means the in-page fetches carry the
    // right cookies and referer rather than looking like bare requests.
    await session.page.goto('https://www.instagram.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    for (const account of target) {
      console.log(`@${account.username}`);

      let userId = account.igUserId;
      if (!userId) {
        userId = await resolveUserId(session.page, account.username);
        if (!userId) {
          console.warn('  could not resolve user id, skipping');
          count.error++;
          continue;
        }
        await jitteredDelay(1500);
      }

      let postList;
      try {
        postList = await fetchRecentPost(session.page, userId, {
          maxPost: option.maxPost,
          skipOlderThanDay: 90,
        });
      } catch (err) {
        if (err instanceof InstagramBlockedError) {
          console.error(`\nInstagram returned ${err.status}. Stopping the run rather than pushing through.`);
          break;
        }
        throw err;
      }

      console.log(`  ${postList.length} recent post(s)`);

      if (postList.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= EMPTY_ACCOUNT_ABORT_THRESHOLD) {
          console.error(
            `\n${consecutiveEmpty} accounts in a row returned nothing. ` +
            'That is a block, not a coincidence. Stopping.',
          );
          break;
        }
        if (!option.isDryRun && account.sourceAccountId > 0) {
          await markAccountScraped(account.sourceAccountId, userId);
        }
        await jitteredDelay(DELAY_BETWEEN_ACCOUNT_MS);
        continue;
      }
      consecutiveEmpty = 0;

      for (const post of postList) {
        try {
          const outcome = await extractEvent({
            caption: post.caption,
            username: account.username,
            postedAt: post.postedAt,
            knownVenueList: knownVenueNameList,
            venueProfile: {
              venueType: account.venueType,
              categoryDistribution: account.categoryDistribution,
              typicalHours: account.typicalHours,
              recurringEventList: account.recurringEvent,
            },
          });

          if (outcome.unknownCategory) count.unknownCategory++;

          if (!option.isDryRun) {
            const sourcePostId = await savePost({
              accountId: account.sourceAccountId > 0 ? account.sourceAccountId : null,
              shortcode: post.shortcode,
              postUrl: post.postUrl,
              postType: post.postType,
              caption: post.caption,
              postedAt: post.postedAt,
              imageUrl: post.imageUrlList[0] ?? null,
              imageUrlList: post.imageUrlList,
              likeCount: post.likeCount,
              commentCount: post.commentCount,
              isEvent: outcome.result.isEvent,
              rawExtraction: outcome.result,
              extractionMethod: outcome.provenance.method,
              extractionModel: outcome.provenance.model,
              promptVersion: outcome.provenance.promptVersion,
              extractedAt: outcome.provenance.extractedAt,
              aiConfidence: outcome.result.confidence,
            });
            count.post++;

            const result = outcome.result;
            if (result.isEvent && result.eventTitle && result.eventDate) {
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
                imageUrl: post.imageUrlList[0] ?? null,
                sourceUsername: account.username,
                sourcePostId,
                sourceAccountId: account.sourceAccountId > 0 ? account.sourceAccountId : null,
                subEventList: result.subEventList?.map(entry => ({
                  title: entry.title,
                  eventDate: entry.date,
                  eventTime: entry.time,
                  endTime: entry.endTime,
                  description: entry.description,
                })) ?? null,
              });
              count.event++;
              console.log(`  ✓ ${result.eventTitle} (${result.eventDate})`);
            }
          } else if (outcome.result.isEvent) {
            count.event++;
            console.log(`  [dry] ${outcome.result.eventTitle} (${outcome.result.eventDate})`);
          }
        } catch (err) {
          // An auth failure burns quota on every subsequent call, so it
          // stops the run rather than being counted and retried.
          if (err instanceof ExtractorAuthError) throw err;
          count.error++;
          console.warn(`  post ${post.shortcode} failed: ${err instanceof Error ? err.message : err}`);
        }

        await jitteredDelay(DELAY_BETWEEN_EXTRACTION_MS);
      }

      if (!option.isDryRun && account.sourceAccountId > 0) {
        await markAccountScraped(account.sourceAccountId, userId);
        count.account++;
      }

      await jitteredDelay(DELAY_BETWEEN_ACCOUNT_MS);
    }

    if (!option.isDryRun) await completeSyncRun(syncLogId, count);

    console.log(
      `\n${option.isDryRun ? '[dry run] ' : ''}account ${count.account}, post ${count.post}, ` +
      `event ${count.event}, errors ${count.error}, unknown categories ${count.unknownCategory}`,
    );
  } catch (err) {
    if (!option.isDryRun) await failSyncRun(syncLogId, err, count);
    console.error('\nScrape failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await session.close();
    await pgConnection.end({ timeout: 5 });
  }
}

/** Venue names spliced into the extraction prompt so spellings match. */
async function loadVenueNameList(): Promise<string[]> {
  const { db, venue } = await import('@wheresthefx/db');
  const rowList = await db.select({ name: venue.name }).from(venue);
  return rowList.map(row => row.name);
}

void main();
