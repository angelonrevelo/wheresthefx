# Conventions

Defers to `~/.claude/skills/convention` for the universal rules. This file records only what is
specific to wheresthefx, plus the carve-outs.

Enforced by `npm run lint:naming` ([`script/validate-naming.ts`](../script/validate-naming.ts),
dependency-free) over every `.sql` migration and every `.ts`/`.tsx` in `app/`, `package/`, and
`script/`. Run the whole set with `npm run check`.

> The previous version of this file kept a "Future Improvements" checklist with `{table}_id`
> primary keys and "no raw Drizzle in routes" unticked. Both stayed unticked while the schema
> grew. A rule that lives only in a document is one that gets re-broken by whoever did not read
> it, so the mechanically checkable rules are now checked and this file explains only reasoning.

## The headline rule

**Singular everywhere, including collections.** `event: EventRow[]`, not `events`. `marker`,
`cluster`, `candidate` — all singular. Counts are the exception in spirit but not in form: they
take the `_count` suffix (`event_count`, `view_count`, `draft_count`).

Directory names too: `app/api/src/route/`, not `routes/`; `app/web/src/component/`, not
`components/`. The gate checks directory names as well as identifiers, with a short allowlist for
mass nouns (`middleware`) and for names a framework fixes for us (`assets`, which is Vite's).

## Casing: two worlds, one boundary

This is the rule most likely to look inconsistent until you see where the line falls.

- **snake_case** for anything that is *data*: SQL columns, API request and response bodies, DAL
  row interfaces, the tripi draft contract. An `{Entity}Row` interface mirrors its columns exactly.
- **camelCase** for anything that is *code*: local variables, function parameters, Drizzle's
  property names, React props, internal domain types no wire format sees.

So `findEventForExport(sinceDate)` returns rows shaped `{ event_id, event_date }`. The parameter
is code; the row is data. [`package/core/src/geo.ts`](../package/core/src/geo.ts) is camelCase
throughout because a `Coordinate` never touches a column;
[`package/core/src/tripi.ts`](../package/core/src/tripi.ts) is snake_case throughout because every
field in it is a tripi column name.

`Coordinate` spells out `latitude`/`longitude` even though the columns are `lat`/`lng`, because
that is the name the wire contract uses. `toCoordinate` is the one place that bridges them — a
type that silently renames its own fields invites a mapping bug.

## Time

`event_date` is a bare `date`. A calendar day has no instant, and letting a `Date` get built in
the server's zone is how you get an off-by-one for anyone west of UTC.

**"Today" is always Manila local, never UTC.** Use `manilaToday()` from `@wheresthefx/core`, never
`new Date().toISOString().split('T')[0]`. Manila is UTC+8, so for the first eight hours of every
Manila day UTC still reads as yesterday — precisely when people are getting home from the events
this indexes. Four call sites had that bug, and `/api/events/upcoming` served an
already-finished day for the life of the product.

`event_time` and `end_time` are `HH:MM` text, not `time` columns, because the extractor routinely
produces neither ("doors at 9", null); text keeps the unparseable case visible instead of failing
an insert. The tripi bridge normalises to `HH:MM` or null at the boundary.

Anything that is an instant is `timestamptz`. Never bare `timestamp` — the gate rejects it on both
the SQL and the Drizzle side (`timestamp('created_at', { withTimezone: true })`).

## Layering

- **Routes are HTTP only.** Parse params, call down, serialise. No SQL, no business logic.
- **`src/db/` holds every statement.** Row interfaces are `{Entity}Row`, snake_case, matching the
  columns exactly.
- **`package/core` is pure.** No database, no Express, no React, no DOM, no clock it does not take
  as an argument.

The gate enforces the first: a `drizzle-orm` or `@wheresthefx/db` import inside `src/route/` is a
violation.

This is not tidiness for its own sake. tripi has no ORM — its routes call `src/db/`, its services
are pure — so the boundary is what lets logic move between the two repos with only the query
rewritten. See [TRIPI.md](TRIPI.md).

### Carve-out: Drizzle stays, but only in the DAL

tripi is raw `pg` with hand-written SQL, so the two repos are not copy-paste compatible at the
query layer. That is accepted: dropping Drizzle would be a large rewrite whose only benefit is
portability of the one layer that is cheapest to rewrite anyway. What is portable is everything
above it, which is why the DAL boundary is enforced rather than merely encouraged.

## API surface

Request and response bodies are snake_case, matching the columns. The `snakeCaseResponse`
middleware converts Drizzle's camelCase output on the way out so handlers need not think about
it — but it is a *walk over keys*, not a contract. Anything already snake_case (the tripi drafts)
passes through untouched, and a key that should not be converted has nowhere to hide. New
surfaces are better off selecting snake_case aliases in the DAL and not relying on it.

Errors are `{ error: string }`, written for a person.

A malformed filter is a 400, never silently dropped. Quietly ignoring a filter the caller asked
for returns wrong data that looks right, which is worse than an error.

## Copy

**No em dash in anything a user reads.** Enforced by `npm run lint:copy`
([`script/validate-copy.ts`](../script/validate-copy.ts)), which scans `app/web/src` and skips
comments — source comments keep theirs, since the only readers are us.

Rewrite rather than swapping in a hyphen. An em dash usually joins two clauses, so a hyphen leaves
a sentence that reads like a typo. Use a full stop, a comma, parentheses, or the middle dot the
app already uses as a separator.

## Legacy the schema still carries

**`event_category` holds three retired values** — `art_culture`, `gaming`, `other` — kept so
existing rows stay readable. Nothing should write them. `normalizeCategory()` maps them onto live
values; a backfill retires them once no row references them. Do not add a fourth: a value that
might grow belongs in a lookup table, not an ENUM.

**`completeness_score` and `confidence` are both 0..1 and are not the same number.** `confidence`
is the extractor's belief that this is a real event; `completeness_score` is how many fields got
filled. Dedup ranks on completeness; quality gating reads confidence.

**Denormalized display fields are deliberate.** `event.venue_name`, `event.source_username`, and
`event.image_url` duplicate their normalized sources so a list query needs no join. The FK
(`venue_id`, `source_account_id`) is the truth for joins; the copy is what the extractor actually
saw. The tripi export reads the copy on purpose — disagreeing with it silently would move a pin
without saying so.

## Known gaps

Listed rather than hidden. None of these are enforced, so the gate will not stop you.

- **No `deleted_at` anywhere.** Nothing here is soft-deleted; dedup hard-deletes losing rows. If a
  table ever needs it, the rule is `deleted_at timestamptz`, never `is_deleted`.
- **No table or column `COMMENT`s.** The reasoning lives in `package/db/src/schema.ts` docblocks,
  which means it is invisible from `psql`.
- **`sync_log` counts are plural** (`accounts_synced`, `posts_synced`, ...). They should be
  `account_sync_count` and so on, per the `_count` rule.
- **The map data path is `any`.** Three overlapping event shapes (`EventPopup`, `EventSidePanel`,
  the marker payload) need unifying before it can be typed.
