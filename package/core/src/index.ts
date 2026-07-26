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

// `findRepoRoot` is deliberately NOT re-exported here. It reads the
// filesystem, and this entry point is bundled into the browser: pulling
// `node:fs` through it broke `vite build` outright. Node callers import
// `@wheresthefx/core/repo` directly.
