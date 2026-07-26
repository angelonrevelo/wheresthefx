import { config } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Environment loading, anchored to the repo root.
 *
 * `import 'dotenv/config'` reads `.env` from `process.cwd()`. Under
 * `npm run --workspace @wheresthefx/ingest`, cwd is `package/ingest`,
 * so the root `.env` was never found and every command failed claiming
 * its variables were unset. Same for any relative path in that file:
 * `data/session/ig-session.json` would resolve inside the workspace.
 *
 * Import this instead of `dotenv/config`, and resolve paths with
 * `fromRepoRoot`.
 */

/**
 * Walk up from this module to the directory holding the workspace root
 * package.json. Anchored to the module rather than cwd so it does not
 * matter where the command was invoked from.
 */
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 10; depth++) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
        // The root manifest is the one that declares workspaces.
        if (parsed.workspaces) return dir;
      } catch {
        // Unreadable manifest: keep walking.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Nothing found — fall back to cwd rather than throwing, so a command
  // run from an unusual layout still starts and reports missing vars.
  return process.cwd();
}

export const repoRoot = findRepoRoot();

config({ path: join(repoRoot, '.env') });

/** Resolve a possibly-relative path against the repo root. */
export function fromRepoRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}
