import { fromRepoRoot } from '../env.js';
import Database from 'better-sqlite3';
import { normalizeCategory, type Category } from '@wheresthefx/core';
import { sql as pgConnection } from '@wheresthefx/db';
import { assignReviewTier } from '../identity/hash.js';
import { saveEvent, type EventDraft } from '../store/event.js';
import { upsertAccount, type AccountCategory } from '../store/account.js';
import { loadVenueIndex, upsertVenue } from '../store/venue.js';
import {
  completeSyncRun,
  emptyCount,
  failSyncRun,
  startSyncRun,
  type SyncCount,
} from '../store/sync.js';

/**
 * Re-ingest a recovered SQLite snapshot into PostgreSQL.
 *
 * This is a one-directional import of history, not the live pipeline —
 * the scraper writes to Postgres directly. It exists because the
 * recovered database holds 2,368 events, 361 venues, and 212 accounts
 * that were either never imported or were imported through the broken
 * path: categories collapsed to `other`, image URLs written to a column
 * that did not exist, aliases silently discarded.
 *
 *   BLEAD_DB_PATH=./data/ig-events.db \
 *   DATABASE_URL=postgres://... \
 *   npx tsx package/ingest/src/command/reingest.ts [--dry-run]
 */

interface SqliteVenue {
  name: string;
  aliases: string | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  instagram_handle: string | null;
}

interface SqliteAccount {
  username: string;
  ig_user_id: string | null;
  display_name: string | null;
  bio: string | null;
  profile_pic_url: string | null;
  follower_count: number | null;
  following_count: number | null;
  post_count: number | null;
  is_verified: number | null;
  is_business: number | null;
  category: string | null;
  is_active: number | null;
  venue_type: string | null;
  category_distribution: string | null;
  typical_hours: string | null;
  recurring_events: string | null;
}

interface SqliteEvent {
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
  location_status: string | null;
  is_free: number | null;
  price: number | null;
  price_min: number | null;
  price_max: number | null;
  price_notes: string | null;
  signup_url: string | null;
  category: string | null;
  artists: string | null;
  event_status: string | null;
  availability_status: string | null;
  is_recurring: number | null;
  recurrence_pattern: string | null;
  confidence: number | null;
  image_url: string | null;
  source_username: string | null;
}

function parseJsonList(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : null;
  } catch {
    return null;
  }
}

const ACCOUNT_CATEGORY = new Set(['nightlife', 'venue', 'promoter', 'artist', 'community', 'other']);

function parseJsonObject<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

const LOCATION_STATUS = new Set(['confirmed', 'tba', 'secret', 'dm_for_details']);
const EVENT_STATUS = new Set(['confirmed', 'rescheduled', 'cancelled', 'postponed', 'tentative']);
const AVAILABILITY_STATUS = new Set(['available', 'sold_out', 'waitlist', 'limited', 'early_bird']);

function oneOf<T extends string>(value: string | null, allowed: Set<string>, fallback: T): T {
  return value && allowed.has(value) ? (value as T) : fallback;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A date the database will accept, or null. */
function validDate(raw: string | null): string | null {
  if (!raw || !ISO_DATE.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

async function main(): Promise<void> {
  const dbPath = process.env.BLEAD_DB_PATH;
  if (!dbPath) {
    console.error('BLEAD_DB_PATH is required.');
    process.exit(1);
  }
  const isDryRun = process.argv.includes('--dry-run');

  const sqlite = new Database(fromRepoRoot(dbPath), { readonly: true, fileMustExist: true });
  const count: SyncCount = emptyCount();
  const syncLogId = isDryRun ? -1 : await startSyncRun();

  // Categories the source used that this taxonomy does not know. Counted
  // and reported rather than coerced — silently mapping them to `other`
  // is exactly how five categories disappeared from the product.
  const unknownCategoryTally = new Map<string, number>();

  try {
    // ---- Venues first: events reference them ---------------------------
    const venueRowList = sqlite.prepare('SELECT * FROM known_venue').all() as SqliteVenue[];
    console.log(`venue:   ${venueRowList.length} rows`);

    for (const row of venueRowList) {
      if (!row.name?.trim()) { count.error++; continue; }
      try {
        if (!isDryRun) {
          await upsertVenue({
            name: row.name.trim(),
            alias: parseJsonList(row.aliases),
            address: row.address,
            city: row.city,
            lat: row.lat,
            lng: row.lng,
            instagramHandle: row.instagram_handle,
          });
        }
        count.venue++;
      } catch (err) {
        count.error++;
        console.warn(`  venue "${row.name}" failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // ---- Accounts: the watchlist the scraper reads ---------------------
    const accountRowList = sqlite.prepare('SELECT * FROM ig_account').all() as SqliteAccount[];
    console.log(`account: ${accountRowList.length} rows`);

    for (const row of accountRowList) {
      if (!row.username?.trim()) { count.error++; continue; }
      try {
        if (!isDryRun) {
          await upsertAccount({
            username: row.username.trim(),
            igUserId: row.ig_user_id,
            fullName: row.display_name,
            bio: row.bio,
            profilePicUrl: row.profile_pic_url,
            followerCount: row.follower_count,
            followingCount: row.following_count,
            postCount: row.post_count,
            isVerified: row.is_verified === 1,
            isBusiness: row.is_business === 1,
            category: row.category && ACCOUNT_CATEGORY.has(row.category)
              ? (row.category as AccountCategory)
              : 'other',
            venueType: row.venue_type,
            categoryDistribution: parseJsonObject<Record<string, number>>(row.category_distribution),
            typicalHours: row.typical_hours,
            recurringEvent: parseJsonObject<{ name: string; frequency: string }[]>(row.recurring_events),
            isActive: row.is_active !== 0,
          });
        }
        count.account++;
      } catch (err) {
        count.error++;
        console.warn(`  account "${row.username}" failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // ---- Events --------------------------------------------------------
    const venueIndex = isDryRun ? null : await loadVenueIndex();
    const eventRowList = sqlite.prepare('SELECT * FROM ig_event').all() as SqliteEvent[];
    console.log(`event:   ${eventRowList.length} rows`);

    let insertedCount = 0;
    let updatedCount = 0;
    let keptCount = 0;

    for (const row of eventRowList) {
      const eventDate = validDate(row.event_date);
      if (!row.event_title?.trim() || !eventDate) { count.error++; continue; }

      let category: Category | null = null;
      if (row.category) {
        category = normalizeCategory(row.category);
        if (!category) {
          unknownCategoryTally.set(row.category, (unknownCategoryTally.get(row.category) ?? 0) + 1);
          count.unknownCategory++;
        }
      }

      const matchedVenue = venueIndex?.match(row.venue_name) ?? null;
      const confidence = row.confidence ?? 0;

      const draft: EventDraft = {
        title: row.event_title.trim(),
        eventDate,
        eventEndDate: validDate(row.event_end_date),
        eventTime: row.event_time,
        endTime: row.end_time,
        description: row.description,
        venueId: matchedVenue?.venueId ?? null,
        venueName: row.venue_name,
        venueAddress: row.venue_address,
        // Prefer the matched venue's geocode over the event's own copy.
        venueLat: matchedVenue?.lat ?? row.venue_lat,
        venueLng: matchedVenue?.lng ?? row.venue_lng,
        locationStatus: oneOf(row.location_status, LOCATION_STATUS, 'confirmed'),
        isFree: row.is_free === null ? null : row.is_free === 1,
        price: row.price,
        priceMin: row.price_min,
        priceMax: row.price_max,
        priceNote: row.price_notes,
        signupUrl: row.signup_url,
        category,
        artist: parseJsonList(row.artists),
        eventStatus: oneOf(row.event_status, EVENT_STATUS, 'confirmed'),
        availabilityStatus: oneOf(row.availability_status, AVAILABILITY_STATUS, 'available'),
        isRecurring: row.is_recurring === 1,
        recurrencePattern: row.recurrence_pattern,
        confidence,
        imageUrl: row.image_url,
        sourceUsername: row.source_username,
      };

      // Recomputed rather than copied: the source's tier was assigned by a
      // different pipeline version against different thresholds.
      draft.reviewTier = assignReviewTier(confidence, {
        title: draft.title,
        eventDate: draft.eventDate,
        eventTime: draft.eventTime,
        venueName: draft.venueName,
      });

      try {
        if (isDryRun) { insertedCount++; count.event++; continue; }
        const outcome = await saveEvent(draft);
        if (outcome === 'inserted') insertedCount++;
        else if (outcome === 'updated') updatedCount++;
        else keptCount++;
        count.event++;
      } catch (err) {
        count.error++;
        console.warn(`  event "${row.event_title}" failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    console.log(`\n  inserted ${insertedCount}, updated ${updatedCount}, kept ${keptCount}`);

    if (unknownCategoryTally.size > 0) {
      console.warn('\n  categories not in the taxonomy (NOT coerced):');
      for (const [name, tally] of [...unknownCategoryTally].sort((a, b) => b[1] - a[1])) {
        console.warn(`    ${name}: ${tally}`);
      }
    }

    if (!isDryRun) await completeSyncRun(syncLogId, count);

    console.log(
      `\n${isDryRun ? '[dry run] ' : ''}venue ${count.venue}, event ${count.event}, ` +
      `errors ${count.error}, unknown categories ${count.unknownCategory}`,
    );
    if (count.error > 0) {
      console.warn('Completed with errors — see sync_log.error_count.');
    }
  } catch (err) {
    if (!isDryRun) await failSyncRun(syncLogId, err, count);
    console.error('Re-ingest failed:', err);
    process.exitCode = 1;
  } finally {
    sqlite.close();
    await pgConnection.end({ timeout: 5 });
  }
}

void main();
