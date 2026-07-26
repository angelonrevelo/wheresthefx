import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRepoRoot } from './repo.js';

/**
 * Two outages came from resolving paths against `process.cwd()`:
 * `.env` was never found under `npm run --workspace`, and the ingest
 * scheduler resolved its working directory to `/` under pm2 and failed
 * silently on every tick.
 *
 * The cwd depends on how a process was launched. These assert the root
 * is found from the module's own location instead, from any depth.
 */

const thisDir = dirname(fileURLToPath(import.meta.url));

describe('findRepoRoot', () => {
  it('finds the workspace root from a nested module', () => {
    const root = findRepoRoot(thisDir);
    expect(existsSync(join(root, 'package.json'))).toBe(true);
    expect(existsSync(join(root, 'app'))).toBe(true);
    expect(existsSync(join(root, 'package'))).toBe(true);
  });

  it('finds the same root regardless of starting depth', () => {
    // package/core/src → package/core → package
    const fromSrc = findRepoRoot(thisDir);
    const fromPackage = findRepoRoot(dirname(thisDir));
    const fromWorkspace = findRepoRoot(dirname(dirname(thisDir)));
    expect(fromPackage).toBe(fromSrc);
    expect(fromWorkspace).toBe(fromSrc);
  });

  it('stops at the manifest declaring workspaces, not the first one found', () => {
    // package/core has its own package.json without a `workspaces` key.
    // Returning that would put every relative path one level too deep.
    const root = findRepoRoot(thisDir);
    expect(root.endsWith('core')).toBe(false);
    expect(root.endsWith('package')).toBe(false);
  });

  it('gives up rather than looping forever on an unrooted path', () => {
    // Falls back to cwd, which keeps a command running instead of
    // throwing somewhere unhelpful.
    expect(() => findRepoRoot('/', 3)).not.toThrow();
  });
});
