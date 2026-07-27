# Database & Code Conventions

Rules for writing consistent, refactorable code in the WheresTheFX codebase.
Modeled after [sisia-app CONVENTIONS.md](../../../sisia-app/docs/CONVENTIONS.md).

## Database

| Convention             | Rule                                                         | Example                                       |
| ---------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| **Column naming**      | `snake_case`, never camelCase                                | `event_date`, `venue_name`                    |
| **Table naming**       | Singular noun, no reserved words (sisia convention)          | `event`, `venue`, `source_account`, `account` |
| **Timestamps**         | Every table gets `created_at TIMESTAMPTZ DEFAULT NOW()`      | —                                             |
| **Constrained values** | Named Postgres ENUMs                                         | `CREATE TYPE event_category AS ENUM (...)`    |
| **Indexes**            | `idx_{table}_{column}`                                       | `idx_event_date`, `idx_event_category`        |
| **Primary keys**       | `{table}_id`, never a bare `id`                              | `event_id`, `venue_id`, `sync_log_id`         |

> [!NOTE]
> Tables use singular names. `users` was renamed to `account` to avoid the
> PostgreSQL reserved word, and `user_preferences` to `account_preference`.
> `script/validate-naming.ts` enforces the table, column, primary-key and
> `timestamptz` rules; it fails the build rather than warning.

## TypeScript

| Convention             | Rule                                        | Example                                     |
| ---------------------- | ------------------------------------------- | ------------------------------------------- |
| **Variables**          | camelCase in TS, snake_case only in SQL/API | `const eventDate = row.event_date`          |
| **Imports**            | `.js` extension for local ESM imports       | `import { event } from '../db/schema.js'`   |
| **Row types**          | `{Entity}Data` with snake_case fields       | `EventData { event_date, venue_name, ... }` |
| **API response types** | Match the snake_case API contract exactly   | `{ is_free: true, price_notes: '...' }`     |

## API Response Format

All API responses use **snake_case** keys, shaped by explicit DTOs in
`app/api/src/lib/dto.ts`.

A `snakeCaseResponse` middleware used to walk every response and convert
casing automatically. It was removed: it was not injective (`imageURL`
became `image_u_r_l`), it would have mangled JSONB payloads, and because
it derived the contract from whatever the ORM returned, renaming the
primary keys to `{table}_id` silently dropped `id` from every response.
A DTO makes the public shape something you have to change on purpose.

### Example response

```json
{
  "data": [
    {
      "id": 864,
      "title": "Live Music @ 70s Bistro",
      "event_date": "2026-03-15",
      "event_time": "20:00",
      "venue_name": "70s Bistro",
      "venue_lat": 14.630706,
      "venue_lng": 121.06137,
      "is_free": false,
      "price": 350,
      "category": "music",
      "image_url": "https://...",
      "source_username": "70sbistro"
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

### Envelope shape

| Endpoint              | Response shape                       |
| --------------------- | ------------------------------------ |
| `GET /api/events`     | `{ data: [...], pagination: {...} }` |
| `GET /api/events/map` | `{ data: [...] }`                    |
| `GET /api/events/:id` | `{ id, title, ... }` (flat)          |
| `GET /api/venues`     | `{ data: [...] }`                    |
| `GET /api/categories` | `{ data: [...] }`                    |
| Error responses       | `{ error: "message" }`               |

## File Organization

An npm workspace monorepo. Directory names are singular, and that is
enforced too.

```
app/api/src/
├── lib/          ← param parsing, DTOs, SSRF and freshness guards
├── middleware/   ← JWT auth
├── route/        ← HTTP handlers
└── scheduler.ts  ← in-process ingest timer
app/web/src/
├── api/          ← API client
├── component/    ← UI
├── constant/     ← category colours
├── hook/         ← React Query hooks
├── page/         ← route pages
└── util/         ← cluster, markerIcon, smoothWheelZoom
package/
├── core/         ← taxonomy, Manila time, repo root
├── db/           ← schema + migration, the only copy
└── ingest/       ← scrape, extract, geocode, store
```

See [README.md](README.md) for the full tree.

## Gates

Three custom gates run in `npm run check`, before ESLint. Each exists
because the mistake it catches is silent — none of them would be caught
by TypeScript or a linter.

| Gate | Script | Catches |
| --- | --- | --- |
| naming | `script/validate-naming.ts` | plural table or directory names, bare `id` primary keys, `timestamp` without a zone, raw Drizzle in a route |
| copy | `script/validate-copy.ts` | em dashes in text a user reads. Comments keep theirs |
| class | `script/validate-class.ts` | Tailwind class names that do not exist |

The class gate is the newest. `pointer-event-none` — singular — appeared
eighteen times across ten files; Tailwind's utility is plural, so every
one of them was silently dropped. One was load-bearing: an invisible
overlay kept intercepting input and the map could not be dragged at all.
The rule list holds mistakes actually made in this repo, not everything
Tailwind might reject, because a gate that guesses gets switched off.

`npm run check` also builds the client. Lint and typecheck both pass on a
bundle that will not build.

## Future Improvements

These are tracked but deferred:

- [x] Rename tables to singular (`event` instead of `events`)
- [x] Rename `users` → `account` (reserved-word convention)
- [x] Rename PKs to `{table}_id`
- [ ] Add DAL layer (no raw Drizzle in routes)
- [ ] Add `{Entity}Row` and `{Entity}Safe` shared types
