# Database schema

`package/db/src/schema.ts` is the source of truth. This page is a
reference, generated against the live database — if the two disagree,
the schema file wins and this page is stale.

Columns are `snake_case`. Tables are singular nouns and every primary key
is `{table}_id`, never a bare `id`. Every timestamp is `timestamptz`.
See [CONVENTIONS.md](CONVENTIONS.md); `script/validate-naming.ts` enforces
all three.

## Enums

| Enum | Values |
| --- | --- |
| `event_category` | `nightlife`, `music`, `arts`, `film`, `comedy`, `food`, `markets`, `sports`, `fitness`, `workshops`, `tech`, `community` — plus legacy `art_culture`, `gaming`, `other` |
| `event_status` | `confirmed`, `rescheduled`, `cancelled`, `postponed`, `tentative` |
| `availability_status` | `available`, `sold_out`, `waitlist`, `limited`, `early_bird` |
| `location_status` | `confirmed`, `tba`, `secret`, `dm_for_details` |
| `review_tier` | `ready`, `quick`, `full`, `rejected`, `pending` |
| `account_category` | `nightlife`, `venue`, `promoter`, `artist`, `community`, `other` |
| `sync_status` | `running`, `completed`, `failed` |

The twelve real categories are the canonical taxonomy in
`package/core/src/category.ts`. `art_culture` and `gaming` are retired
values kept only so old rows still read; `normalizeCategory` maps them
forward. `other` is not a category the extractor may choose — an
unrecognised value surfaces as `null` plus the raw string, because
coercing to `other` is how five of the twelve were silently lost.

`location_status` carries `secret` and `dm_for_details` because Manila's
underground scene routinely announces events that way, and flattening
them to `confirmed` destroys the distinction.

## Tables

### venue

Canonical venue directory.

| Column | Type | Notes |
| --- | --- | --- |
| `venue_id` | serial | PK |
| `name` | text | NOT NULL, UNIQUE |
| `alias` | jsonb | Other spellings; read by the venue matcher |
| `address`, `city` | text | |
| `lat`, `lng` | real | Null until geocoded |
| `category` | text | |
| `instagram_handle` | text | |
| `geocode_attempted_at` | timestamptz | Set whether or not geocoding succeeded, so permanent failures stop being retried |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | |

### source_account

The Instagram watchlist.

| Column | Type | Notes |
| --- | --- | --- |
| `source_account_id` | serial | PK |
| `username` | text | NOT NULL, UNIQUE |
| `ig_user_id` | text | Cached numeric id; resolving it is a separate rate-limited call |
| `full_name`, `bio`, `profile_pic_url` | text | |
| `follower_count`, `following_count`, `post_count` | integer | |
| `is_verified`, `is_business` | boolean | |
| `category` | `account_category` | Classifies the poster, not the event |
| `venue_type` | text | Drives the extractor's venue-profile override |
| `category_distribution` | jsonb | Historical category mix, same purpose |
| `typical_hours` | text | |
| `recurring_event` | jsonb | |
| `is_active` | boolean | Deactivate rather than delete |
| `last_scraped_at` | timestamptz | Drives scrape ordering |
| `created_at` | timestamptz | NOT NULL |

### source_post

Raw posts plus extraction provenance.

| Column | Type | Notes |
| --- | --- | --- |
| `source_post_id` | serial | PK |
| `account_id` | integer | FK → `source_account` |
| `shortcode` | text | NOT NULL, UNIQUE — the dedup key |
| `post_url` | text | NOT NULL |
| `post_type` | text | |
| `caption` | text | |
| `posted_at` | timestamptz | |
| `image_url` | text | |
| `image_url_list` | jsonb | |
| `like_count`, `comment_count` | integer | |
| `is_event` | boolean | |
| `raw_extraction` | jsonb | The model's full response |
| `extraction_method` | text | |
| `extraction_model` | text | |
| `prompt_version` | text | Which prompt produced this row |
| `extracted_at` | timestamptz | |
| `ai_confidence` | real | |
| `created_at` | timestamptz | NOT NULL |

The provenance columns are what make a quality question answerable.
Without them, "is the model ignoring this rule or do these rows predate
it?" can only be guessed at from timestamps.

### event

| Column | Type | Notes |
| --- | --- | --- |
| `event_id` | serial | PK |
| `source_post_id` | integer | FK → `source_post`. Null on rows imported from the recovered snapshot |
| `source_account_id` | integer | FK → `source_account`. Also null on those rows |
| `title` | text | NOT NULL |
| `event_date` | date | NOT NULL |
| `event_end_date` | date | |
| `event_time`, `end_time` | text | `HH:MM`, 24-hour |
| `description` | text | |
| `venue_id` | integer | FK → `venue` |
| `venue_name`, `venue_address` | text | Denormalised for display |
| `venue_lat`, `venue_lng` | real | Denormalised for the map query |
| `location_status` | `location_status` | |
| `is_free` | boolean | |
| `price`, `price_min`, `price_max` | real | |
| `price_note` | text | Carries "free entrance, ₱500 consumable" |
| `signup_url` | text | |
| `category` | `event_category` | |
| `artist` | jsonb | |
| `event_status` | `event_status` | |
| `availability_status` | `availability_status` | |
| `is_recurring` | boolean | |
| `recurrence_pattern` | text | |
| `completeness_score` | real | Decides which row wins a hash collision |
| `confidence` | real | The model's own |
| `review_tier` | `review_tier` | Quality gate |
| `image_url` | text | |
| `source_username` | text | Denormalised; the only account link legacy rows have |
| `event_hash` | text | UNIQUE — `sha256(title + date + venue)` |
| `created_at`, `updated_at` | timestamptz | NOT NULL |

`source_username` looks redundant next to `source_account_id` and is not.
Rows imported from the recovered snapshot have only the username, and the
duplicate-merge rule falls back to it — without that fallback a legacy
row could never match its re-extracted twin.

### sub_event

Multi-act lineups and screening schedules.

| Column | Type | Notes |
| --- | --- | --- |
| `sub_event_id` | serial | PK |
| `event_id` | integer | FK → `event`, NOT NULL |
| `title` | text | NOT NULL |
| `event_date` | date | |
| `event_time`, `end_time` | text | |
| `description` | text | |
| `created_at` | timestamptz | NOT NULL |

### account

Platform users.

| Column | Type | Notes |
| --- | --- | --- |
| `account_id` | serial | PK |
| `email` | varchar | NOT NULL |
| `username` | varchar | NOT NULL |
| `password_hash` | text | NOT NULL, bcrypt |
| `display_name`, `avatar_url` | text | |
| `created_at`, `updated_at` | timestamptz | NOT NULL |

### saved_event

Bookmarks. A merge repoints these at the surviving event rather than
letting the cascade delete them.

| Column | Type | Notes |
| --- | --- | --- |
| `saved_event_id` | serial | PK |
| `account_id` | integer | FK → `account`, NOT NULL |
| `event_id` | integer | FK → `event`, NOT NULL |
| `saved_at` | timestamptz | NOT NULL |

### account_preference

| Column | Type | Notes |
| --- | --- | --- |
| `account_preference_id` | serial | PK |
| `account_id` | integer | FK → `account`, NOT NULL |
| `preferred_category` | jsonb | |
| `updated_at` | timestamptz | NOT NULL |

### sync_log

One row per ingest run. See [ingest.md](ingest.md).

| Column | Type | Notes |
| --- | --- | --- |
| `sync_log_id` | serial | PK |
| `started_at` | timestamptz | NOT NULL |
| `completed_at` | timestamptz | |
| `status` | `sync_status` | NOT NULL |
| `account_synced_count` | integer | |
| `post_synced_count` | integer | |
| `event_synced_count` | integer | |
| `venue_synced_count` | integer | |
| `sub_event_synced_count` | integer | |
| `error_count` | integer | Rows that failed individually |
| `unknown_category_count` | integer | Categories the taxonomy did not recognise |
| `error_message` | text | |
| `created_at` | timestamptz | NOT NULL |

## Indexes

- `event.event_hash` — unique, dedup
- `event.event_date`, `event.category`, `event.event_status`, `event.venue_id`, `event.source_account_id`
- `source_post.shortcode` — unique
- `source_account.username` — unique
- `venue.name` — unique
- `venue.geocode_attempted_at`
- `saved_event(account_id, event_id)` — unique

`venue.name` being unique is why the venue merge deletes losing rows
before renaming the survivor: the winning name is often held by a loser.

## Relations

- `event` → `venue`, `source_post`, `source_account` (many-to-one)
- `sub_event` → `event` (many-to-one)
- `saved_event` → `account` + `event` (junction)
- `account_preference` → `account` (one-to-one)

## Migrations

Versioned, under `package/db/migration/`. Generate with
`npm run db:generate`, apply with `npm run db:migrate`. There was no
migration history before the restructure, so no schema change was
reversible.
