/**
 * @wheresthefx/db — the single source of truth for the database.
 *
 * Both the API (`app/api`) and the ingestion pipeline (`package/ingest`)
 * import their schema from here. That is deliberate: the previous ingest
 * silently wrote ~20 columns that did not exist on the server's schema
 * because each side kept its own copy. One package, one schema, no drift.
 */

export * from './schema.js';
export { db, sql } from './connection.js';
export { ENV_FILE } from './env.js';
