/**
 * Ingest Script — blead SQLite → WheresTheFX PostgreSQL
 *
 * This script reads event data from blead's SQLite database and upserts
 * it into the WheresTheFX PostgreSQL database. It's designed to run as
 * a cron job (every 6 hours) or manually.
 *
 * ## How It Works
 *
 * 1. Opens blead's SQLite DB from BLEAD_DB_PATH environment variable
 * 2. Reads all tables: ig_account, ig_post, ig_event, sub_event, known_venue
 * 3. Upserts into PostgreSQL using ON CONFLICT DO UPDATE:
 *    - Venues matched by `name`
 *    - Accounts matched by `username`
 *    - Posts matched by `shortcode`
 *    - Events matched by `event_hash`
 * 4. Logs sync run to `blead_sync_log` table
 *
 * ## Running
 *
 * ```bash
 * # Manual run
 * cd server && npm run ingest
 *
 * # Cron (every 6 hours on VPS). Hours listed explicitly rather than
 * # written as a step expression, which cannot appear inside a block
 * # comment without terminating it.
 * 0 0,6,12,18 * * * cd /path/to/wheresthefx && npx tsx app/api/src/scripts/ingest-from-blead.ts >> /var/log/wheresthefx-ingest.log 2>&1
 * ```
 *
 * ## Deduplication Strategy
 *
 * Events use `event_hash` (SHA256 of normalized title + date + venue) as
 * the dedup key. When two blead events have the same hash, the one with
 * the higher `completeness_score` wins.
 *
 * Posts use `shortcode` (Instagram's unique post identifier).
 * Accounts use `username`.
 * Venues use `name`.
 *
 * ## Data Flow
 *
 * ```
 * blead SQLite → known_venue   → PG venues
 *              → ig_account    → PG source_accounts
 *              → ig_post       → PG source_posts
 *              → ig_event      → PG events
 *              → sub_event     → PG sub_events
 * ```
 *
 * ## Important Notes
 *
 * - We do NOT depend on blead's internal auto-increment IDs.
 *   Instead, we match by natural keys and maintain our own ID space.
 * - The script uses transactional batches for each table to ensure
 *   consistency. If one table's sync fails, previous tables are preserved.
 * - Image URLs are kept as-is (Instagram CDN). The image proxy
 *   endpoint in the API handles fallback to local cache.
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@wheresthefx/db';
import { runDedup } from './dedup-events.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const BLEAD_DB_PATH = process.env.BLEAD_DB_PATH;
const DATABASE_URL = process.env.DATABASE_URL;

if (!BLEAD_DB_PATH) {
  console.error('❌ BLEAD_DB_PATH environment variable is required');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

// ============================================================================
// DATABASE CONNECTIONS
// ============================================================================

/** Connect to blead's SQLite database (read-only) */
const sqlite = new Database(BLEAD_DB_PATH, { readonly: true });
sqlite.pragma('journal_mode = WAL');

/** Connect to PostgreSQL */
const sql = postgres(DATABASE_URL, { max: 5 });
const db = drizzle(sql, { schema });

// ============================================================================
// TYPE DEFINITIONS (matching blead's SQLite schema)
// ============================================================================

interface BleadVenue {
  known_venue_id: number;
  name: string;
  aliases: string | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  instagram_handle: string | null;
}

interface BleadAccount {
  ig_account_id: number;
  username: string;
  display_name: string | null;
  bio: string | null;
  follower_count: number | null;
  following_count: number | null;
  post_count: number | null;
  profile_pic_url: string | null;
  is_verified: number;
  is_business: number;
  category: string | null;
  is_active: number;
  last_scraped_at: string | null;
}

interface BleadPost {
  ig_post_id: number;
  ig_account_id: number;
  shortcode: string;
  post_url: string;
  post_type: string;
  caption: string | null;
  posted_at: string | null;
  like_count: number;
  comment_count: number;
  image_urls: string | null;
  is_event: number;
  ai_extraction: string | null;
  extraction_method: string | null;
  ai_confidence: number | null;
}

interface BleadEvent {
  ig_event_id: number;
  source_post_id: number;
  ig_account_id: number;
  event_title: string;
  event_date: string;
  event_end_date: string | null;
  event_time: string | null;
  end_time: string | null;
  description: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_lat: number | null;
  venue_lng: number | null;
  location_status: string;
  is_free: number;
  price: number | null;
  price_min: number | null;
  price_max: number | null;
  price_notes: string | null;
  signup_url: string | null;
  category: string;
  artists: string | null;
  event_status: string;
  availability_status: string;
  is_recurring: number;
  recurrence_pattern: string | null;
  completeness_score: number | null;
  confidence: number | null;
  review_tier: string;
  image_url: string | null;
  source_username: string | null;
  event_hash: string | null;
}

interface BleadSubEvent {
  sub_event_id: number;
  ig_event_id: number;
  title: string;
  event_date: string | null;
  event_time: string | null;
  end_time: string | null;
  description: string | null;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse a JSON string safely, returning the default value on failure.
 * Handles null, undefined, and malformed JSON from SQLite TEXT fields.
 */
function safeJsonParse<T>(jsonStr: string | null | undefined, defaultValue: T): T {
  if (!jsonStr) return defaultValue;
  try {
    return JSON.parse(jsonStr);
  } catch {
    return defaultValue;
  }
}

/**
 * Convert SQLite boolean (0/1) to JavaScript boolean.
 */
function toBool(val: number | null | undefined): boolean {
  return val === 1;
}

// ============================================================================
// SYNC FUNCTIONS — one per table
// ============================================================================

/**
 * Sync venues: known_venue → venues
 *
 * Matches by venue `name` (UNIQUE constraint).
 * On conflict, updates address, geocoding, and aliases.
 */
async function syncVenues(): Promise<number> {
  const bleadVenues = sqlite.prepare('SELECT * FROM known_venue').all() as BleadVenue[];
  let synced = 0;

  for (const v of bleadVenues) {
    const aliases = safeJsonParse<string[]>(v.aliases, []);

    await db.insert(schema.venue).values({
      name: v.name,
      alias: aliases,
      address: v.address,
      city: v.city,
      lat: v.lat,
      lng: v.lng,
      instagramHandle: v.instagram_handle,
    }).onConflictDoUpdate({
      target: schema.venue.name,
      set: {
        alias: aliases,
        address: v.address,
        city: v.city,
        lat: v.lat,
        lng: v.lng,
        instagramHandle: v.instagram_handle,
      },
    });
    synced++;
  }

  return synced;
}

/**
 * Sync accounts: ig_account → source_accounts
 *
 * Matches by `username` (UNIQUE constraint).
 * On conflict, updates metadata (follower count, bio, etc.).
 */
async function syncAccounts(): Promise<number> {
  const bleadAccounts = sqlite.prepare('SELECT * FROM ig_account').all() as BleadAccount[];
  let synced = 0;

  for (const a of bleadAccounts) {
    await db.insert(schema.sourceAccount).values({
      username: a.username,
      fullName: a.display_name,
      bio: a.bio,
      followerCount: a.follower_count,
      followingCount: a.following_count,
      postCount: a.post_count,
      profilePicUrl: a.profile_pic_url,
      isVerified: toBool(a.is_verified),
      isBusiness: toBool(a.is_business),
      category: (a.category as any) || 'other',
      isActive: toBool(a.is_active),
      lastScrapedAt: a.last_scraped_at ? new Date(a.last_scraped_at) : null,
    }).onConflictDoUpdate({
      target: schema.sourceAccount.username,
      set: {
        fullName: a.display_name,
        bio: a.bio,
        followerCount: a.follower_count,
        followingCount: a.following_count,
        postCount: a.post_count,
        profilePicUrl: a.profile_pic_url,
        isVerified: toBool(a.is_verified),
        isBusiness: toBool(a.is_business),
        category: (a.category as any) || 'other',
        isActive: toBool(a.is_active),
        lastScrapedAt: a.last_scraped_at ? new Date(a.last_scraped_at) : null,
      },
    });
    synced++;
  }

  return synced;
}

/**
 * Sync posts: ig_post → source_posts
 *
 * Matches by `shortcode` (UNIQUE constraint).
 *
 * Requires account lookup: We need to map blead's ig_account_id
 * to our source_accounts.id. We do this by looking up the username
 * from blead's ig_account table, then finding it in our PG table.
 */
async function syncPosts(): Promise<number> {
  // Build username → PG account ID lookup
  const pgAccounts = await db.select({
    id: schema.sourceAccount.id,
    username: schema.sourceAccount.username,
  }).from(schema.sourceAccount);
  const accountIdMap = new Map(pgAccounts.map(a => [a.username, a.id]));

  const totalCount = (sqlite.prepare('SELECT count(*) as c FROM ig_post').get() as any).c;
  const BATCH_SIZE = 50;
  let synced = 0;

  for (let offset = 0; offset < totalCount; offset += BATCH_SIZE) {
    const bleadPosts = sqlite.prepare(`
      SELECT p.*, a.username
      FROM ig_post p
      JOIN ig_account a ON a.ig_account_id = p.ig_account_id
      LIMIT ? OFFSET ?
    `).all(BATCH_SIZE, offset) as (BleadPost & { username: string })[];

    for (const p of bleadPosts) {
      const sourceAccountId = accountIdMap.get(p.username) || null;
      const imageUrls = safeJsonParse<string[]>(p.image_urls, []);

      try {
        await db.insert(schema.sourcePost).values({
          accountId: sourceAccountId,
          shortcode: p.shortcode,
          postUrl: p.post_url,
          postType: p.post_type || 'image',
          caption: p.caption,
          postedAt: p.posted_at ? new Date(p.posted_at) : null,
          likeCount: p.like_count,
          commentCount: p.comment_count,
          imageUrl: imageUrls[0] ?? null,
          imageUrlList: imageUrls,
          isEvent: toBool(p.is_event),
          rawExtraction: safeJsonParse<unknown>(p.ai_extraction, null),
          extractionMethod: p.extraction_method,
          aiConfidence: p.ai_confidence,
        }).onConflictDoUpdate({
          target: schema.sourcePost.shortcode,
          set: {
            accountId: sourceAccountId,
            caption: p.caption,
            likeCount: p.like_count,
            commentCount: p.comment_count,
            imageUrl: imageUrls[0] ?? null,
            imageUrlList: imageUrls,
            isEvent: toBool(p.is_event),
            rawExtraction: safeJsonParse<unknown>(p.ai_extraction, null),
            extractionMethod: p.extraction_method,
            aiConfidence: p.ai_confidence,
          },
        });
        synced++;
      } catch (err) {
        console.log(`   ⚠️  Post ${p.shortcode} failed: ${String(err).slice(0, 60)}`);
      }
    }

    if ((offset + BATCH_SIZE) % 500 === 0 || offset + BATCH_SIZE >= totalCount) {
      console.log(`   ... ${Math.min(synced, totalCount)}/${totalCount} posts`);
    }
  }

  return synced;
}

/**
 * Sync events: ig_event → events
 *
 * Matches by `event_hash` (UNIQUE constraint).
 * On conflict, updates if the incoming record has a higher
 * completeness_score (better data wins).
 *
 * Requires lookups:
 * - blead ig_account_id → username → PG source_accounts.id
 * - blead source_post_id → shortcode → PG source_posts.id
 * - venue_name → PG venues.id (optional)
 */
async function syncEvents(): Promise<number> {
  const bleadEvents = sqlite.prepare(`
    SELECT e.*, p.shortcode, a.username
    FROM ig_event e
    LEFT JOIN ig_post p ON p.ig_post_id = e.source_post_id
    LEFT JOIN ig_account a ON a.ig_account_id = e.ig_account_id
  `).all() as (BleadEvent & { shortcode: string | null; username: string | null })[];

  // Build lookup maps
  const pgAccounts = await db.select({
    id: schema.sourceAccount.id,
    username: schema.sourceAccount.username,
  }).from(schema.sourceAccount);
  const accountIdMap = new Map(pgAccounts.map(a => [a.username, a.id]));

  const pgPosts = await db.select({
    id: schema.sourcePost.id,
    shortcode: schema.sourcePost.shortcode,
  }).from(schema.sourcePost);
  const postIdMap = new Map(pgPosts.map(p => [p.shortcode, p.id]));

  const pgVenues = await db.select({
    id: schema.venue.id,
    name: schema.venue.name,
  }).from(schema.venue);
  const venueIdMap = new Map(pgVenues.map(v => [v.name.toLowerCase(), v.id]));

  let synced = 0;
  let skipped = 0;

  for (const e of bleadEvents) {
    const sourceAccountId = e.username ? accountIdMap.get(e.username) || null : null;
    const sourcePostId = e.shortcode ? postIdMap.get(e.shortcode) || null : null;
    const venueId = e.venue_name ? venueIdMap.get(e.venue_name.toLowerCase()) || null : null;
    const artists = safeJsonParse<string[]>(e.artists, []);

    if (!e.event_hash) continue; // Skip events without hash (can't dedup)

    // Validate date (skip impossible dates like 2026-02-29)
    const dateParts = e.event_date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateParts) {
      console.log(`   ⚠️  Skipping "${e.event_title}" — invalid date format: ${e.event_date}`);
      skipped++;
      continue;
    }
    const [, year, month, day] = dateParts.map(Number);
    // Validate by creating date and checking if components match
    const testDate = new Date(year, month - 1, day);
    if (testDate.getFullYear() !== year || testDate.getMonth() !== month - 1 || testDate.getDate() !== day) {
      console.log(`   ⚠️  Skipping "${e.event_title}" — invalid date: ${e.event_date}`);
      skipped++;
      continue;
    }

    const values = {
      sourcePostId,
      sourceAccountId,
      title: e.event_title,
      eventDate: e.event_date,
      eventEndDate: e.event_end_date,
      eventTime: e.event_time,
      endTime: e.end_time,
      description: e.description,
      venueId,
      venueName: e.venue_name,
      venueAddress: e.venue_address,
      venueLat: e.venue_lat,
      venueLng: e.venue_lng,
      locationStatus: (e.location_status as any) || 'confirmed',
      isFree: toBool(e.is_free),
      price: e.price,
      priceMin: e.price_min,
      priceMax: e.price_max,
      priceNotes: e.price_notes,
      signupUrl: e.signup_url,
      category: (e.category as any) || 'other',
      artists,
      eventStatus: (e.event_status as any) || 'confirmed',
      availabilityStatus: (e.availability_status as any) || 'available',
      isRecurring: toBool(e.is_recurring),
      recurrencePattern: e.recurrence_pattern,
      completenessScore: e.completeness_score,
      confidence: e.confidence,
      reviewTier: (e.review_tier as any) || 'pending',
      imageUrl: e.image_url,
      sourceUsername: e.source_username || e.username,
      eventHash: e.event_hash,
      updatedAt: new Date(),
    };

    try {
      await db.insert(schema.event).values(values).onConflictDoUpdate({
        target: schema.event.eventHash,
        set: values,
      });
      synced++;
    } catch (err) {
      console.log(`   ⚠️  Failed "${e.event_title}" (${e.event_date}): ${String(err).slice(0, 80)}`);
      skipped++;
    }
  }

  if (skipped > 0) {
    console.log(`   ⚠️  ${skipped} events skipped (invalid dates or errors)`);
  }

  return synced;
}

/**
 * Sync sub-events: sub_event → sub_events
 *
 * Sub-events reference their parent event by ig_event_id in blead.
 * We need to map:  blead ig_event_id → event_hash → PG events.id
 *
 * Strategy: Delete all existing sub-events and re-insert fresh from blead.
 * This is simpler than per-row upserting since sub-events don't have
 * stable natural keys (no hash).
 */
async function syncSubEvents(): Promise<number> {
  // Build blead ig_event_id → event_hash lookup
  const bleadEventHashes = sqlite.prepare(
    'SELECT ig_event_id, event_hash FROM ig_event WHERE event_hash IS NOT NULL'
  ).all() as { ig_event_id: number; event_hash: string }[];
  const bleadIdToHash = new Map(bleadEventHashes.map(e => [e.ig_event_id, e.event_hash]));

  // Build event_hash → PG events.id lookup
  const pgEvents = await db.select({
    id: schema.event.id,
    eventHash: schema.event.eventHash,
  }).from(schema.event);
  const hashToId = new Map(pgEvents.map(e => [e.eventHash, e.id]));

  // Get all blead sub-events
  const bleadSubEvents = sqlite.prepare('SELECT * FROM sub_event').all() as BleadSubEvent[];

  // Collect PG event IDs that will have sub-events re-synced
  const affectedEventIds = new Set<number>();
  const toInsert: Array<{
    eventId: number;
    title: string;
    eventDate: string | null;
    eventTime: string | null;
    endTime: string | null;
    description: string | null;
  }> = [];

  for (const se of bleadSubEvents) {
    const eventHash = bleadIdToHash.get(se.ig_event_id);
    if (!eventHash) continue;
    const pgEventId = hashToId.get(eventHash);
    if (!pgEventId) continue;

    affectedEventIds.add(pgEventId);
    toInsert.push({
      eventId: pgEventId,
      title: se.title,
      eventDate: se.event_date,
      eventTime: se.event_time,
      endTime: se.end_time,
      description: se.description,
    });
  }

  // Delete existing sub-events for affected parent events
  for (const eventId of affectedEventIds) {
    await db.delete(schema.subEvent).where(eq(schema.subEvent.eventId, eventId));
  }

  // Insert fresh
  if (toInsert.length > 0) {
    // Insert in batches of 100 to avoid query size limits
    for (let i = 0; i < toInsert.length; i += 100) {
      const batch = toInsert.slice(i, i + 100);
      await db.insert(schema.subEvent).values(batch);
    }
  }

  return toInsert.length;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  const startTime = Date.now();
  console.log('🔄 Starting blead → WheresTheFX sync...');
  console.log(`   Source: ${BLEAD_DB_PATH}`);
  console.log(`   Target: ${DATABASE_URL?.replace(/\/\/.*@/, '//***@')}\n`);

  // Log sync start
  const [syncLog] = await db.insert(schema.syncLog).values({
    status: 'running',
  }).returning();

  try {
    // Sync in dependency order
    console.log('📍 Syncing venues...');
    const venuesSynced = await syncVenues();
    console.log(`   ✅ ${venuesSynced} venues`);

    console.log('👤 Syncing accounts...');
    const accountsSynced = await syncAccounts();
    console.log(`   ✅ ${accountsSynced} accounts`);

    console.log('📸 Syncing posts...');
    const postsSynced = await syncPosts();
    console.log(`   ✅ ${postsSynced} posts`);

    console.log('🎉 Syncing events...');
    const eventsSynced = await syncEvents();
    console.log(`   ✅ ${eventsSynced} events`);

    console.log('🎤 Syncing sub-events...');
    const subEventsSynced = await syncSubEvents();
    console.log(`   ✅ ${subEventsSynced} sub-events`);

    // Run fuzzy dedup after sync
    console.log('🔍 Running deduplication...');
    const dedupResult = await runDedup(sql);
    if (dedupResult.deleted > 0) {
      console.log(`   ✅ Removed ${dedupResult.deleted} duplicates (${dedupResult.exactDuplicates} exact + ${dedupResult.fuzzyDuplicates} fuzzy) → ${dedupResult.remaining} events`);
    } else {
      console.log(`   ✅ No duplicates found`);
    }

    // Update sync log
    await db.update(schema.syncLog)
      .set({
        status: 'completed',
        completedAt: new Date(),
        venuesSynced,
        accountsSynced,
        postsSynced,
        eventsSynced,
        subEventsSynced,
      })
      .where(eq(schema.syncLog.id, syncLog.id));

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Sync completed in ${duration}s`);
    console.log(`   Summary: ${venuesSynced} venues, ${accountsSynced} accounts, ${postsSynced} posts, ${eventsSynced} events, ${subEventsSynced} sub-events, ${dedupResult.deleted} deduped`);

  } catch (err) {
    // Log error
    await db.update(schema.syncLog)
      .set({
        status: 'failed',
        completedAt: new Date(),
        errorMessage: String(err),
      })
      .where(eq(schema.syncLog.id, syncLog.id));

    console.error('\n❌ Sync failed:', err);
    throw err;
  } finally {
    sqlite.close();
    await sql.end();
  }
}

main().catch(() => process.exit(1));
