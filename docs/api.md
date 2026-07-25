# API Reference

Base URL: `https://api.wheresthefx.com/api` (production) or `http://localhost:3001/api` (local)

All responses use **snake_case** keys (auto-converted by middleware). Common envelope:

```json
{
  "data": [...],
  "pagination": { "page": 1, "limit": 20, "total": 230, "total_pages": 12 }
}
```

---

## Authentication

### POST /auth/register

Create a new account.

**Request:**

```json
{
  "email": "user@example.com",
  "username": "myuser",
  "password": "securepass123"
}
```

**Response (201):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "username": "myuser"
  }
}
```

### POST /auth/login

Authenticate and receive JWT token.

**Request:**

```json
{
  "email": "user@example.com",
  "password": "securepass123"
}
```

**Response (200):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "username": "myuser"
  }
}
```

### GET /auth/me

Get current account profile. Requires `Authorization: Bearer <token>`.

**Response (200):**

```json
{
  "id": 1,
  "email": "user@example.com",
  "username": "myuser",
  "display_name": null,
  "created_at": "2026-03-12T07:30:00.000Z"
}
```

---

## Events

### GET /events

List events with filtering and pagination.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `category` | string | Filter by category enum value |
| `search` | string | Search in title, description, venue name, address |
| `is_free` | boolean | Filter free events (`true`/`false`) |
| `date_from` | string | Start date (YYYY-MM-DD) |
| `date_to` | string | End date (YYYY-MM-DD) |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20, max: 100) |

**Response (200):**

```json
{
  "data": [
    {
      "id": 1,
      "title": "Salcedo Market",
      "event_date": "2026-03-15",
      "event_time": "07:00",
      "end_time": "14:00",
      "description": "Weekend community market...",
      "venue_name": "Jaime Velasquez Park",
      "venue_address": "Salcedo Village, Makati",
      "venue_lat": 14.5609,
      "venue_lng": 121.0224,
      "is_free": true,
      "category": "markets",
      "image_url": "https://scontent...",
      "source_username": "salcedomarket",
      "event_hash": "a1b2c3d4...",
      "is_saved": false
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 230,
    "total_pages": 12
  }
}
```

### GET /events/upcoming

Get upcoming events (filtered to future dates).

**Query: `?limit=50`**

### GET /events/map

Get events with geocoding for map display. Returns only events that have `venue_lat` and `venue_lng`:

```json
{
  "data": [
    {
      "id": 1,
      "title": "Salcedo Market",
      "event_date": "2026-03-15",
      "event_time": "07:00",
      "venue_name": "Jaime Velasquez Park",
      "venue_lat": 14.5609,
      "venue_lng": 121.0224,
      "category": "markets",
      "is_free": true,
      "image_url": "https://..."
    }
  ]
}
```

### GET /events/:id

Get full event detail with related data.

**Response includes:** venue info, sub-events, source post, source account.

---

## Venues

### GET /venues

List all venues with event counts.

```json
{
  "data": [
    {
      "id": 1,
      "name": "Jaime Velasquez Park",
      "address": "Salcedo Village, Makati",
      "category": null,
      "lat": 14.5609,
      "lng": 121.0224,
      "event_count": 3
    }
  ]
}
```

### GET /venues/:id

Get venue detail.

### GET /venues/:id/events

Get all events at a specific venue.

---

## Categories

### GET /categories

Get all categories with upcoming event counts and display metadata.

```json
{
  "data": [
    { "value": "music", "label": "Live Music", "emoji": "🎵", "count": 12 },
    {
      "value": "markets",
      "label": "Markets & Fairs",
      "emoji": "🛍️",
      "count": 4
    },
    { "value": "nightlife", "label": "Nightlife", "emoji": "🌙", "count": 0 }
  ]
}
```

---

## User Endpoints

All require `Authorization: Bearer <token>`.

### GET /users/me/saved

Get the current account's saved events.

### POST /users/me/saved

Toggle save/unsave an event.

**Request:**

```json
{ "event_id": 42 }
```

**Response:**

```json
{ "saved": true }
```

### GET /users/me/preferences

Get account's preferred categories.

**Response:**

```json
{ "category": ["music", "nightlife", "food"] }
```

### PUT /users/me/preferences

Replace preferred categories. Values are validated against the canonical
taxonomy; an unrecognised value returns 400 rather than being stored.

**Request:**

```json
{ "category": ["music", "nightlife", "food"] }
```

---

## Image Proxy

### GET /images/proxy

Proxy Instagram images with local cache fallback.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `url` | string | Required. Instagram CDN URL |
| `shortcode` | string | Optional. Post shortcode for cache lookup |

Returns the image binary with correct content-type headers.

**Why it exists:** Instagram CDN URLs expire within hours. The proxy checks
the local cache at `BLEAD_IMAGES_PATH/{shortcode}/` **first** (instant, no
network), falls back to the CDN with a 5s timeout, and writes successful
CDN responses back into the cache.

**Validation.** Both parameters are attacker-controlled and both are
checked before use:

| Rule | Rejected with |
|------|---------------|
| `url` must be `https:` | 400 |
| `url` host must be `*.cdninstagram.com` or `*.fbcdn.net` (dot-anchored) | 400 |
| `url` must not be an IP literal or carry credentials | 400 |
| `shortcode` must match `^[A-Za-z0-9_-]{1,64}$` | ignored (no cache hit) |
| Upstream `Content-Type` must be jpeg/png/webp/gif | 415 |
| Response larger than 8MB | 413 |

Redirects are not followed (`redirect: 'manual'`), so an allowlisted host
cannot bounce the proxy into the internal network.

---

## Export (the tripi feed)

wheresthefx is one of [tripitropi.com](https://tripitropi.com)'s catalog sources. These two
endpoints reshape the same venue and event data the rest of this API serves into tripi's draft
contract, so its bulk ingest can consume it the same way it consumes OSM, Foursquare, and
Overture. Read-only, unauthenticated, snake_case already.

Full contract, every skip reason, and the tripi-side changes required: [TRIPI.md](TRIPI.md).

### GET /export/place-draft

The whole venue directory as tripi place drafts. Unpaginated on purpose: the catalog is in the low
thousands, tripi's ingest wants one convergent pass rather than a cursor to resume, and a partial
catalog would let its `(name, area)` dedupe mint rows it later has to merge.

```json
{
  "source": "wheresthefx",
  "version": 1,
  "exported_at": "2026-07-26T02:00:00.000Z",
  "draft": [
    {
      "source": "wheresthefx",
      "name": "19 East",
      "area_name": "Parañaque",
      "address_line": "19th Ave, Sucat",
      "category_tag": ["live music", "music venue", "gig"],
      "latitude": 14.5233,
      "longitude": 121.0478,
      "external_ref": "venue/19",
      "confidence": null,
      "skip_reason": null
    }
  ],
  "draft_count": 1,
  "skipped": [{ "external_ref": "venue/20", "skip_reason": "no name" }]
}
```

`confidence` is null for venues deliberately: there is no prominence signal for one on this side,
and a made-up `1.0` would outrank Overture's real scores in any ranking tripi applies.

### GET /export/event-draft

Upcoming confirmed events as tripi event drafts — every place field above, plus `title`,
`event_date`, `event_end_date`, `start_time`, `end_time`, `price_band`, `is_free`, `category`, and
`source_url`.

| Param   | Type                | Description                                    |
| ------- | ------------------- | ---------------------------------------------- |
| `since` | string (YYYY-MM-DD) | Floor on `event_date`. Clamped to today Manila. |

A malformed `since` is a `400`, not a silently wider window.

Filtered to `event_date >= today in Manila`, `event_status = 'confirmed'`, and
`review_tier <> 'rejected'` — a cancelled event or an extractor false positive is worse in an
itinerary than a missing one.

**Skips are reported, not dropped.** A record that cannot become a place is still emitted in
`skipped` with its reason (`no date`, `no title`, `no venue name`, `no coordinate`, `no name`), so
"why is this spot missing" has an answer. This mirrors tripi's own `place_ingest.skip_reason`.

---

## Health

### GET /health

Liveness plus dependency check. Returns 503 if PostgreSQL is unreachable.

```json
{
  "status": "ok",
  "database": "ok",
  "ingest": { "last_sync_at": "2026-07-26T02:00:00.000Z", "is_stale": false },
  "checked_at": "2026-07-26T02:31:00.000Z"
}
```

`status` is `degraded` when no ingest has completed in the last 24 hours.
The endpoint previously returned `ok` without touching the database, so it
stayed green through a four-month ingest outage.

---

## Rate Limits

| Scope | Window | Limit |
|-------|--------|-------|
| `/api/*` | 1 min | 300 |
| `/api/auth/*` | 15 min | 20 (successful requests not counted) |
| `/api/images/proxy` | 1 min | 200 |

Exceeding a limit returns 429 with `{ "error": "Too many requests" }`.

---

## Error Responses

All errors follow:

```json
{
  "error": "Human-readable error message"
}
```

Common status codes:

- `400` — Bad request / validation error
- `401` — Missing or invalid JWT token
- `404` — Resource not found
- `409` — Conflict (e.g., duplicate email/username)
- `500` — Internal server error

## Authentication Header

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

JWT tokens expire after 7 days. The token contains `{ userId, email }`.
