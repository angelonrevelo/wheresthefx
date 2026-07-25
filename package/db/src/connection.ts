/**
 * Database Connection — PostgreSQL via Drizzle ORM
 *
 * Creates a singleton database connection using the `postgres` driver
 * (porsager/postgres) with Drizzle ORM. The connection URL comes from
 * the DATABASE_URL environment variable.
 *
 * ## Usage
 * ```ts
 * import { db } from './connection';
 * const upcomingEvent = await db.query.event.findMany();
 * ```
 *
 * ## Environment
 * Requires `DATABASE_URL` in .env, e.g.:
 * `postgresql://postgres:postgres@localhost:5432/wheresthefx`
 */

// Must be the first import: it populates process.env, and the check below reads it at module
// scope. `dotenv/config` used to sit here and could not find the root .env from a workspace cwd.
import './env.js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

/**
 * Raw postgres.js connection.
 * Used by Drizzle internally. Exposed for cases where you need
 * to run raw SQL outside of the ORM.
 */
export const sql = postgres(process.env.DATABASE_URL, {
  max: 10, // Connection pool size
});

/**
 * Drizzle ORM instance with full schema awareness.
 *
 * Supports both the query builder API and the relational query API:
 * - Query builder: `db.select().from(event).where(...)`
 * - Relational:    `db.query.event.findMany({ with: { venue: true } })`
 */
export const db = drizzle(sql, { schema });
