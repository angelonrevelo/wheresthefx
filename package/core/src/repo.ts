import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Locate the workspace root from a module's own location.
 *
 * Anchoring to `process.cwd()` and walking a fixed number of levels has
 * now caused two separate outages in this repo:
 *
 * - `dotenv` read `.env` relative to the cwd, so every ingest command run
 *   through `npm run --workspace` insisted its variables were unset.
 * - The ingest scheduler resolved its working directory as
 *   `resolve(process.cwd(), '../..')`, which is correct when started from
 *   `app/api` and resolves to `/` when pm2 starts it from the repo root.
 *   It failed silently on every tick for hours.
 *
 * The cwd is a property of how a process was launched, not of where the
 * code lives. This walks up from a known module instead, stopping at the
 * manifest that declares workspaces.
 */
export function findRepoRoot(startDir: string, maxDepth = 12): string {
  let dir = startDir;

  for (let depth = 0; depth < maxDepth; depth++) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
        if (parsed.workspaces) return dir;
      } catch {
        // Unreadable manifest: keep walking rather than give up here.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Falling back to the cwd keeps a command running in an unusual layout
  // rather than refusing to start; callers report what they could not find.
  return process.cwd();
}
