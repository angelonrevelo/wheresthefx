/**
 * @wheresthefx/core — contracts shared by the web app, the API, and the
 * ingestion pipeline.
 *
 * Anything that more than one workspace needs to agree on lives here:
 * the category taxonomy, the Manila-time helpers, the coordinate maths,
 * and the tripi export contract.
 *
 * ## The portability rule
 *
 * Every module in this package is pure: no database, no Express, no React,
 * no DOM, no clock it does not take as an argument. That is enforced by
 * having no runtime dependency beyond `zod`, and it is what lets tripi
 * consume this tree without inheriting this repo's stack. Adding an import
 * of `@wheresthefx/db` here would break the bridge described in
 * docs/TRIPI.md, not just this package's tidiness.
 */

export * from './category.js';
export * from './geo.js';
export * from './time.js';
export * from './tripi.js';
