import { fromRepoRoot } from '../env.js';
import { db, sourceAccount, sql as pgConnection } from '@wheresthefx/db';
import { and, eq, isNull } from 'drizzle-orm';
import { createStealthSession, jitteredDelay } from '../scraper/stealth.js';
import { resolveUserId } from '../scraper/instagram.js';

/**
 * Resolve and cache the Instagram user id for watchlist accounts missing one.
 *
 *   npx tsx package/ingest/src/command/resolve-account.ts [--deactivate]
 *
 * ## Why this is separate from the scrape
 *
 * `web_profile_info` is rate-limited far harder than the feed, and it
 * now refuses unauthenticated callers outright. A scrape that hits it
 * for a dozen accounts risks the 401 that stops the whole run, so the
 * lookup happens here, deliberately and slowly, and the id is cached on
 * the account forever after.
 *
 * ## `--deactivate`
 *
 * A username that cannot be resolved with a valid session is almost
 * always gone: renamed, deleted, or a typo carried in the seed list.
 * Passing the flag marks those inactive so the scraper stops spending an
 * attempt on them every run. Off by default, because deactivating an
 * account that failed for a transient reason silently shrinks coverage.
 */

/** Deliberately slow: this endpoint is the one that gets a run blocked. */
const DELAY_BETWEEN_LOOKUP_MS = 4000;

async function main(): Promise<void> {
  const shouldDeactivate = process.argv.includes('--deactivate');

  const pending = await db
    .select({ sourceAccountId: sourceAccount.sourceAccountId, username: sourceAccount.username })
    .from(sourceAccount)
    .where(and(isNull(sourceAccount.igUserId), eq(sourceAccount.isActive, true)));

  if (pending.length === 0) {
    console.log('Every active account already has a cached user id.');
    await pgConnection.end({ timeout: 5 });
    return;
  }

  console.log(`resolving ${pending.length} account(s)\n`);

  const session = await createStealthSession({
    headless: true,
    proxyUrl: process.env.IG_PROXY_URL,
    sessionPath: fromRepoRoot(process.env.IG_SESSION_PATH ?? 'data/session/ig-session.json'),
  });

  if (!session.isAuthenticated) {
    console.warn('No session loaded. This endpoint rejects anonymous callers, so every lookup will fail.\n');
  }

  let resolved = 0;
  const unresolved: string[] = [];

  try {
    await session.page.goto('https://www.instagram.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    for (const account of pending) {
      const userId = await resolveUserId(session.page, account.username);

      if (userId) {
        await db.update(sourceAccount)
          .set({ igUserId: userId })
          .where(eq(sourceAccount.sourceAccountId, account.sourceAccountId));
        resolved++;
        console.log(`  ✓ @${account.username} -> ${userId}`);
      } else {
        unresolved.push(account.username);
        console.log(`  ✗ @${account.username}`);
      }

      await jitteredDelay(DELAY_BETWEEN_LOOKUP_MS);
    }

    if (shouldDeactivate && unresolved.length > 0) {
      for (const username of unresolved) {
        await db.update(sourceAccount)
          .set({ isActive: false })
          .where(eq(sourceAccount.username, username));
      }
      console.log(`\ndeactivated ${unresolved.length} unresolvable account(s)`);
    }

    console.log(`\nresolved ${resolved}/${pending.length}`);
    if (unresolved.length > 0 && !shouldDeactivate) {
      console.log(
        `still unresolved: ${unresolved.join(', ')}\n` +
        'These are usually renamed, deleted, or a typo in the seed list. ' +
        'Re-run with --deactivate to stop attempting them each scrape.',
      );
    }
  } finally {
    await session.close();
    await pgConnection.end({ timeout: 5 });
  }
}

void main();
