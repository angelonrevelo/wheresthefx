---
description: How to add a new schema table to the WheresTheFX database
---

# Add Schema Table

## Steps

1. Open `package/db/src/schema.ts`

2. If you need a new enum, add it:

```typescript
export const myStatusEnum = pgEnum("my_status", [
  "active",
  "inactive",
  "archived",
]);
```

3. Add the new table definition:

```typescript
export const myTable = pgTable("my_table", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  status: myStatusEnum("status").default("active"),
  accountId: integer("account_id").references(() => account.id),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});
```

4. Add relations if needed:

```typescript
export const myTableRelation = relations(myTable, ({ one, many }) => ({
  account: one(account, {
    fields: [myTable.accountId],
    references: [account.id],
  }),
}));
```

5. Push the schema to PostgreSQL:

```bash
cd /Users/angelonrevelo/Antigravity/wheresthefx/server && ./node_modules/.bin/npm run db:generate && npm run db:migrate
```

## Column Types Reference

| Drizzle                            | PostgreSQL       | Use Case            |
| ---------------------------------- | ---------------- | ------------------- |
| `serial('id')`                     | SERIAL           | Auto-increment PK   |
| `integer('count')`                 | INTEGER          | Numbers             |
| `doublePrecision('lat')`           | DOUBLE PRECISION | Coordinates         |
| `varchar('name', { length: 255 })` | VARCHAR(255)     | Short strings       |
| `text('description')`              | TEXT             | Long strings        |
| `boolean('is_active')`             | BOOLEAN          | Flags               |
| `timestamp('created_at')`          | TIMESTAMP        | Dates               |
| `jsonb('data')`                    | JSONB            | JSON objects/arrays |

## Constraints

```typescript
// Unique
name: varchar('name', { length: 255 }).unique().notNull(),

// Foreign key
accountId: integer('account_id').references(() => account.id),

// Default value
createdAt: timestamp('created_at').defaultNow(),

// JSONB default
tags: jsonb('tags').default([]),
```

## Related Files

- Schema: `package/db/src/schema.ts`
- Drizzle config: `server/drizzle.config.ts`
- Connection: `package/db/src/client.ts`
- Conventions: `docs/CONVENTIONS.md`

## Convention Notes

- All column names must be **snake_case** (e.g., `event_date`, not `eventDate`)
- Table names must be **singular** (e.g., `event`, not `events`)
- Use `account` for user tables (PostgreSQL reserved word avoidance)
- The API response middleware auto-converts Drizzle's camelCase JS properties to snake_case
- See `docs/CONVENTIONS.md` for full database/API naming rules
