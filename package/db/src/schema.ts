/**
 * WheresTheFX — PostgreSQL Schema (Drizzle ORM)
 *
 * This schema defines the complete database structure for the WheresTheFX
 * event discovery platform. It mirrors the data model from blead's SQLite
 * database but is designed as a clean PostgreSQL schema with proper types,
 * enums, relations, and platform features (users, saved events).
 *
 * ## Architecture
 *
 * The schema is organized into three layers:
 *
 * ### 1. Source Data (from blead ingest)
 * - `venues` — Canonical venue directory with geocoding
 * - `source_accounts` — Instagram accounts tracked by blead
 * - `source_posts` — Instagram posts (source material for events)
 * - `events` — Core event records extracted by Gemini AI
 * - `sub_events` — Multi-act lineups, screening schedules, etc.
 *
 * ### 2. Platform Features
 * - `account` — Platform user accounts (email + password auth)
 * - `saved_event` — User bookmarks / saved events
 * - `account_preference` — Category preferences for personalization
 *
 * ### 3. Infrastructure
 * - `sync_log` — Tracks ingest pipeline runs and sync health
 *
 * ## Key Design Decisions
 *
 * **No dependency on blead internal IDs:**
 * Events, venues, and accounts are matched by natural keys (event_hash,
 * venue name, username, shortcode) — not by blead's auto-increment IDs.
 * This makes the ingest pipeline resilient to blead DB rebuilds.
 *
 * **Denormalized display fields:**
 * Events carry `venue_name`, `source_username`, and `image_url` as
 * denormalized copies for fast display queries. The normalized FK
 * references (`venue_id`, `source_account_id`) exist for joins.
 *
 * **event_hash deduplication:**
 * Each event has a unique SHA256 hash computed as:
 *   hash(normalize(title) + date + normalize(venue))
 * This prevents duplicate events from being created when the same
 * event is posted by multiple accounts or re-scraped.
 *
 * **PostgreSQL enums:**
 * Categories, statuses, and tiers use PG enums for type safety
 * and storage efficiency. Drizzle maps these to TypeScript union types.
 *
 * **JSONB for arrays:**
 * Fields like `artist` and `alias` use JSONB
 * instead of TEXT with JSON strings for native PostgreSQL querying.
 *
 * ## Category Mapping
 *
 * | Enum Value    | Display Label       |
 * |---------------|---------------------|
 * | nightlife     | 🌙 Nightlife        |
 * | music         | 🎵 Live Music       |
 * | art_culture   | 🎨 Art & Culture    |
 * | markets       | 🛍️ Markets & Fairs  |
 * | food          | 🍜 Food & Drinks    |
 * | community     | 🤝 Community        |
 * | workshops     | 🎓 Workshops        |
 * | comedy        | 😂 Comedy           |
 * | other         | 📌 Other            |
 */

import {
  pgTable,
  pgEnum,
  serial,
  text,
  varchar,
  boolean,
  integer,
  real,
  date,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Event category enum — matches blead's category values.
 * Used for both events and filtering in the UI.
 */
export const eventCategoryEnum = pgEnum('event_category', [
  'nightlife',
  'music',
  'arts',
  'film',
  'comedy',
  'food',
  'markets',
  'sports',
  'fitness',
  'workshops',
  'tech',
  'community',
  // Legacy values kept for backward compat during migration
  'art_culture',
  'gaming',
  'other',
]);

/**
 * Event status — tracks whether an event is happening as planned.
 * blead's AI extractor sets this based on post content analysis.
 */
export const eventStatusEnum = pgEnum('event_status', [
  'confirmed',
  'rescheduled',
  'cancelled',
  'postponed',
  'tentative',
]);

/**
 * Availability status — ticket/capacity status.
 */
export const availabilityStatusEnum = pgEnum('availability_status', [
  'available',
  'sold_out',
  'waitlist',
  'limited',
  'early_bird',
]);

/**
 * Location status — how confirmed the venue is.
 * "dm_for_details" is common in Manila's underground scene.
 */
export const locationStatusEnum = pgEnum('location_status', [
  'confirmed',
  'tba',
  'secret',
  'dm_for_details',
]);

/**
 * Review tier — quality gate for event data.
 * blead assigns this based on completeness_score thresholds.
 * - ready: high confidence, all fields filled → show on site
 * - quick: minor gaps, manually reviewable
 * - full: needs significant review
 * - rejected: not a real event (false positive)
 * - pending: not yet reviewed
 */
export const reviewTierEnum = pgEnum('review_tier', [
  'ready',
  'quick',
  'full',
  'rejected',
  'pending',
]);

/**
 * Source account category — what type of IG account this is.
 * Different from event category — this classifies the poster.
 */
export const accountCategoryEnum = pgEnum('account_category', [
  'nightlife',
  'venue',
  'promoter',
  'artist',
  'community',
  'other',
]);

/**
 * Sync status — for blead ingest log.
 */
export const syncStatusEnum = pgEnum('sync_status', [
  'running',
  'completed',
  'failed',
]);

// ============================================================================
// SOURCE DATA TABLES
// ============================================================================

/**
 * Venues — canonical venue directory with geocoding.
 *
 * `alias` and `instagram_handle` back the venue matcher: incoming venue
 * strings are resolved exact → alias → contains → fuzzy, and the alias
 * list is what makes "19 East" and "19East Bar" the same place. The
 * ingest has always written both, but the columns did not exist, so
 * Drizzle silently discarded them on every run.
 */
export const venue = pgTable('venue', {
  venueId: serial('venue_id').primaryKey(),
  name: text('name').notNull().unique(),
  alias: jsonb('alias').$type<string[]>().default([]),
  address: text('address'),
  city: text('city'),
  lat: real('lat'),
  lng: real('lng'),
  category: text('category'),
  instagramHandle: text('instagram_handle'),
  /** Set whenever geocoding runs, successful or not, so permanent
   *  failures stop being re-queried against Nominatim on every pass. */
  geocodeAttemptedAt: timestamp('geocode_attempted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_venue_geocode_attempted_at').on(table.geocodeAttemptedAt),
]);

/**
 * Source Accounts — Instagram accounts on the watchlist.
 *
 * The profile metadata here is not decoration: `venue_type` and
 * `category_distribution` drive the extractor's venue-profile override,
 * which is what stops a themed DJ night at a bar being classified as
 * `music` instead of `nightlife`. Without these columns the override
 * cannot fire, which measurably degrades category accuracy.
 */
export const sourceAccount = pgTable('source_account', {
  sourceAccountId: serial('source_account_id').primaryKey(),
  username: text('username').notNull().unique(),
  /** Instagram's numeric user id. Cached because resolving it is a
   *  separate, rate-limited profile call the scraper can then skip. */
  igUserId: text('ig_user_id'),
  fullName: text('full_name'),
  bio: text('bio'),
  profilePicUrl: text('profile_pic_url'),
  followerCount: integer('follower_count'),
  followingCount: integer('following_count'),
  postCount: integer('post_count'),
  isVerified: boolean('is_verified').default(false),
  isBusiness: boolean('is_business').default(false),
  category: accountCategoryEnum('category').default('other'),
  venueType: text('venue_type'),
  categoryDistribution: jsonb('category_distribution').$type<Record<string, number>>(),
  typicalHours: text('typical_hours'),
  recurringEvent: jsonb('recurring_event').$type<{ name: string; frequency: string }[]>(),
  isActive: boolean('is_active').default(true),
  lastScrapedAt: timestamp('last_scraped_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_source_account_is_active').on(table.isActive),
]);

/**
 * Source Posts — the raw Instagram posts events are extracted from.
 *
 * `image_url_list` holds every image on a carousel post; `image_url`
 * remains the primary for display. The ingest previously wrote
 * `imageUrls` (a column that never existed) while the real `image_url`
 * column went unwritten — so every row in production has a NULL image.
 */
export const sourcePost = pgTable('source_post', {
  sourcePostId: serial('source_post_id').primaryKey(),
  accountId: integer('account_id').references(() => sourceAccount.sourceAccountId),
  shortcode: text('shortcode').notNull().unique(),
  postUrl: text('post_url').notNull(),
  postType: text('post_type').default('image'),
  caption: text('caption'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  imageUrl: text('image_url'),
  imageUrlList: jsonb('image_url_list').$type<string[]>().default([]),
  likeCount: integer('like_count').default(0),
  commentCount: integer('comment_count').default(0),
  isEvent: boolean('is_event').default(false),
  /** Full extractor response, retained so a prompt regression can be
   *  diagnosed after the fact instead of guessed at. */
  rawExtraction: jsonb('raw_extraction'),
  extractionMethod: text('extraction_method').default('pending'),
  extractionModel: text('extraction_model'),
  promptVersion: text('prompt_version'),
  extractedAt: timestamp('extracted_at', { withTimezone: true }),
  aiConfidence: real('ai_confidence'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_source_post_account').on(table.accountId),
  index('idx_source_post_is_event').on(table.isEvent),
]);

/**
 * Events — the core data table for WheresTheFX.
 *
 * Each row represents one event happening in Metro Manila. Events
 * are extracted from Instagram posts by blead's Gemini AI pipeline.
 *
 * ## Fields of Note
 *
 * - `event_hash` (UNIQUE): SHA256 deduplication key computed as
 *   hash(normalize(title) + date + normalize(venue)). This prevents
 *   duplicates when the same event is posted by multiple accounts.
 *
 * - `venue_id` + `venue_name`: The FK provides normalized venue
 *   reference; the denormalized name enables fast display without joins.
 *
 * - `artist` (JSONB): Array of performer names ["DJ Name", "Band Name"].
 *
 * - `completeness_score` (0-1): Quality score based on how many fields
 *   are filled. Used for dedup ranking — when two events have the same
 *   hash, the one with higher completeness wins.
 *
 * - `confidence` (0-1): Gemini AI's confidence that this is a real event.
 *   93% average across the dataset, 84.5% of events at ≥0.9.
 *
 * - `image_url`: Primary event image URL (Instagram CDN, may expire).
 *   Served through the proxy endpoint which falls back to local cache.
 */
export const event = pgTable('event', {
  eventId: serial('event_id').primaryKey(),
  sourcePostId: integer('source_post_id').references(() => sourcePost.sourcePostId),
  sourceAccountId: integer('source_account_id').references(() => sourceAccount.sourceAccountId),

  // Core event data
  title: text('title').notNull(),
  eventDate: date('event_date').notNull(),
  eventEndDate: date('event_end_date'),
  eventTime: text('event_time'),     // HH:MM format
  endTime: text('end_time'),         // HH:MM format
  description: text('description'),

  // Venue (FK + denormalized)
  venueId: integer('venue_id').references(() => venue.venueId),
  venueName: text('venue_name'),     // Denormalized for fast display
  venueAddress: text('venue_address'),
  venueLat: real('venue_lat'),
  venueLng: real('venue_lng'),
  locationStatus: locationStatusEnum('location_status').default('confirmed'),

  // Pricing
  isFree: boolean('is_free').default(true),
  price: real('price'),
  priceMin: real('price_min'),
  priceMax: real('price_max'),
  priceNote: text('price_note'),

  // Links
  signupUrl: text('signup_url'),

  // Classification
  category: eventCategoryEnum('category').default('other'),
  artist: jsonb('artist').$type<string[]>().default([]),

  // Status
  eventStatus: eventStatusEnum('event_status').default('confirmed'),
  availabilityStatus: availabilityStatusEnum('availability_status').default('available'),
  isRecurring: boolean('is_recurring').default(false),
  recurrencePattern: text('recurrence_pattern'),

  // Quality metrics
  completenessScore: real('completeness_score'),
  confidence: real('confidence'),
  reviewTier: reviewTierEnum('review_tier').default('pending'),

  // Display
  imageUrl: text('image_url'),
  sourceUsername: text('source_username'), // Denormalized

  // Deduplication
  eventHash: text('event_hash').unique(),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_event_date').on(table.eventDate),
  index('idx_event_category').on(table.category),
  index('idx_event_status').on(table.eventStatus),
  index('idx_event_venue').on(table.venueId),
  index('idx_event_hash').on(table.eventHash),
  index('idx_event_account').on(table.sourceAccountId),
]);

/**
 * Sub-Events — multi-act lineups, film schedules, etc.
 *
 * Many Manila events feature multiple acts or spans multiple days.
 * For example, a music festival might have 5 performers each with
 * their own time slot, or a film festival has different screenings.
 *
 * Sub-events are always children of a parent event. They inherit
 * the parent's venue unless overridden.
 *
 * Current data: 178 sub-events across 97 events (avg ~1.8 per event).
 */
export const subEvent = pgTable('sub_event', {
  subEventId: serial('sub_event_id').primaryKey(),
  eventId: integer('event_id').references(() => event.eventId, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  eventDate: date('event_date'),
  eventTime: text('event_time'),
  endTime: text('end_time'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_sub_event_event').on(table.eventId),
]);

// ============================================================================
// PLATFORM FEATURE TABLES
// ============================================================================

/**
 * Users — platform user accounts.
 *
 * Simple email + password auth. Passwords are hashed with bcrypt.
 * Users can save/bookmark events and set category preferences.
 *
 * Note: Users do NOT own events. All events come from the blead
 * scraping pipeline. Users are consumers/discoverers only.
 */
export const account = pgTable('account', {
  accountId: serial('account_id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  username: varchar('username', { length: 50 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('idx_account_email').on(table.email),
  uniqueIndex('idx_account_username').on(table.username),
]);

/**
 * Saved Events — user bookmarks.
 *
 * Many-to-many join between users and events. A user can save
 * any event; saving is idempotent (unique constraint on user+event).
 */
export const savedEvent = pgTable('saved_event', {
  savedEventId: serial('saved_event_id').primaryKey(),
  accountId: integer('account_id').references(() => account.accountId, { onDelete: 'cascade' }).notNull(),
  eventId: integer('event_id').references(() => event.eventId, { onDelete: 'cascade' }).notNull(),
  savedAt: timestamp('saved_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('idx_saved_event_unique').on(table.accountId, table.eventId),
  index('idx_saved_event_account').on(table.accountId),
]);

/**
 * User Preferences — category preferences for personalization.
 *
 * Stores which event categories a user is interested in. This will
 * power a future "For You" personalized feed. The preferred_categories
 * is a JSONB array of enum values like ["nightlife", "music", "food"].
 */
export const accountPreference = pgTable('account_preference', {
  accountPreferenceId: serial('account_preference_id').primaryKey(),
  accountId: integer('account_id').references(() => account.accountId, { onDelete: 'cascade' }).notNull().unique(),
  preferredCategory: jsonb('preferred_category').$type<string[]>().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================================
// INFRASTRUCTURE TABLES
// ============================================================================

/**
 * Blead Sync Log — tracks ingest pipeline runs.
 *
 * Every time the ingest script runs (manually or via cron), a row
 * is logged here. This provides observability into:
 * - When the last sync happened
 * - How many records were synced
 * - Whether any errors occurred
 *
 * The cron job runs every 6 hours. If a sync fails, the next run
 * will pick up from where the last successful sync left off (since
 * upserts are idempotent via event_hash).
 */
export const syncLog = pgTable('sync_log', {
  syncLogId: serial('sync_log_id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  status: syncStatusEnum('status').default('running').notNull(),
  accountSyncedCount: integer('account_synced_count').default(0),
  postSyncedCount: integer('post_synced_count').default(0),
  eventSyncedCount: integer('event_synced_count').default(0),
  venueSyncedCount: integer('venue_synced_count').default(0),
  subEventSyncedCount: integer('sub_event_synced_count').default(0),
  /** Rows that failed and were skipped. A run that drops a third of its
   *  input still logged as `completed` before this column existed. */
  errorCount: integer('error_count').default(0),
  /** Categories the extractor invented. Non-zero means the taxonomy and
   *  the prompt have drifted apart and someone needs to look. */
  unknownCategoryCount: integer('unknown_category_count').default(0),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // The freshness check in /api/health orders by this.
  index('idx_sync_log_started_at').on(table.startedAt),
]);

// ============================================================================
// RELATIONS (for Drizzle's relational query builder)
// ============================================================================

/**
 * Drizzle relations enable the `db.query.events.findMany({ with: {...} })`
 * syntax for eager-loading related data without manual joins.
 */

export const venueRelation = relations(venue, ({ many }) => ({
  event: many(event),
}));

export const sourceAccountRelation = relations(sourceAccount, ({ many }) => ({
  sourcePost: many(sourcePost),
  event: many(event),
}));

export const sourcePostRelation = relations(sourcePost, ({ one, many }) => ({
  sourceAccount: one(sourceAccount, {
    fields: [sourcePost.accountId],
    references: [sourceAccount.sourceAccountId],
  }),
  event: many(event),
}));

export const eventRelation = relations(event, ({ one, many }) => ({
  venue: one(venue, {
    fields: [event.venueId],
    references: [venue.venueId],
  }),
  sourcePost: one(sourcePost, {
    fields: [event.sourcePostId],
    references: [sourcePost.sourcePostId],
  }),
  sourceAccount: one(sourceAccount, {
    fields: [event.sourceAccountId],
    references: [sourceAccount.sourceAccountId],
  }),
  subEvent: many(subEvent),
  savedBy: many(savedEvent),
}));

export const subEventRelation = relations(subEvent, ({ one }) => ({
  event: one(event, {
    fields: [subEvent.eventId],
    references: [event.eventId],
  }),
}));

export const accountRelation = relations(account, ({ many, one }) => ({
  savedEvent: many(savedEvent),
  preference: one(accountPreference, {
    fields: [account.accountId],
    references: [accountPreference.accountId],
  }),
}));

export const savedEventRelation = relations(savedEvent, ({ one }) => ({
  account: one(account, {
    fields: [savedEvent.accountId],
    references: [account.accountId],
  }),
  event: one(event, {
    fields: [savedEvent.eventId],
    references: [event.eventId],
  }),
}));
