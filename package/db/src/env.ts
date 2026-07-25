/**
 * Load the monorepo's `.env`, from wherever the process happens to have started.
 *
 * ## The bug this replaces
 *
 * Every entry point did `import 'dotenv/config'`, which reads exactly
 * `path.resolve(process.cwd(), '.env')` and does not walk up. npm runs a workspace script with
 * the cwd set to that workspace, so `npm run dev:api` looked for `app/api/.env` while the file
 * the Quick Start tells you to create is `.env` at the root. It was never found, `DATABASE_URL`
 * was never set, and the API died on boot with "DATABASE_URL environment variable is required" --
 * on a correctly configured checkout, following the documented steps.
 *
 * It only looked like it worked for anyone who happened to have `DATABASE_URL` exported in their
 * shell already, which is why it survived: the failure is invisible to the person who set the
 * repo up and total for everyone after them.
 *
 * ## Why it lives in package/db
 *
 * Because `package/db` is what actually requires `DATABASE_URL`, so importing it is already a
 * declaration that you need the environment. Every workspace reaches the database through here,
 * which makes this the one place that fixes all of them.
 *
 * It deliberately does NOT live in `package/core`: core is pure by contract -- no filesystem, no
 * `process.env` -- and that constraint is what lets tripi read it. See docs/TRIPI.md.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

/** Depth to search upward. Deep enough for `app/api` or `package/db/src`, shallow enough that a
 *  missing file fails fast rather than crawling to the filesystem root. */
const MAX_DEPTH = 6;

function findEnvFile(): string | null {
  // Two starting points, because neither alone is sufficient: cwd catches a run from the repo
  // root or a workspace, and the module's own directory catches a run from somewhere outside the
  // repo entirely (a cron entry with an absolute path, a globally-installed tsx).
  const start = [process.cwd(), dirname(fileURLToPath(import.meta.url))];

  for (const from of start) {
    let at = resolve(from);
    for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
      const candidate = join(at, '.env');
      if (existsSync(candidate)) return candidate;
      const parent = dirname(at);
      if (parent === at) break; // filesystem root
      at = parent;
    }
  }
  return null;
}

const envFile = findEnvFile();

// `override: false` so a variable already set in the real environment wins. That ordering matters
// in production, where the process is configured by systemd or a container and a stale `.env`
// left in the tree must not quietly replace it.
if (envFile !== null) config({ path: envFile, override: false });

/** Where the `.env` was found, or null if there was none. Exported for diagnostics. */
export const ENV_FILE = envFile;
