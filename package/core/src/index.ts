/**
 * @wheresthefx/core — contracts shared by the web app, the API, and the
 * ingestion pipeline.
 *
 * Anything that more than one workspace needs to agree on lives here:
 * the category taxonomy, the Manila-time helpers, and (as the refactor
 * proceeds) the zod request/response schemas that replace the
 * hand-written snake_case type mirror in the web client.
 */

export * from './category.js';
export * from './time.js';
