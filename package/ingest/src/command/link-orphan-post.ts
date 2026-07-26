import { fromRepoRoot } from '../env.js';
import Database from 'better-sqlite3';
import { db, event, sql as pgConnection, sourceAccount, sourcePost } from '@wheresthefx/db';
import { eq, isNull } from 'drizzle-orm';

/**
 * Link re-extracted posts back to the accounts that made them.
 *
 *   npx tsx package/ingest/src/command/link-orphan-post.ts [--dry-run]
 *
 * ## Why
 *
 * The first run of `reextract-legacy` passed `accountId: null` for every
 * post, orphaning all 5,183 from the watchlist. Nothing broke visibly —
 * events still carry `source_username`, so the map and the cards were
 * unaffected — but every account-level count silently went wrong.
 *
 * That produced a wrong conclusion before it produced a wrong number.
 * Counting accounts that had posts said "the scraper reached 106 of 199",
 * which reads as half the watchlist failing. Counting `last_scraped_at`
 * instead said 161 of 199, with 38 still queued behind a 40-per-run
 * limit on a pipeline that started this morning. Nothing was failing.
 *
 * `source_post` has no username column, so the mapping has to come back
 * from the snapshot: shortcode to username to account.
 */

async function main(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');

  const dbPath = fromRepoRoot(process.env.BLEAD_DB_PATH ?? './data/ig-events.db');
  const sqlite = new Database(dbPath, { readonly: true });

  const mappingList = sqlite.prepare(`
    SELECT p.shortcode, a.username
    FROM ig_post p
    JOIN ig_account a ON a.ig_account_id = p.ig_account_id
    WHERE a.username IS NOT NULL
  `).all() as { shortcode: string; username: string }[];
  sqlite.close();

  const usernameByShortcode = new Map(
    mappingList.map(row => [row.shortcode, row.username.toLowerCase()]),
  );

  const accountRow = await db
    .select({ id: sourceAccount.sourceAccountId, username: sourceAccount.username })
    .from(sourceAccount);
  const accountIdByUsername = new Map(
    accountRow.map(row => [row.username.toLowerCase(), row.id]),
  );

  const orphanList = await db
    .select({ sourcePostId: sourcePost.sourcePostId, shortcode: sourcePost.shortcode })
    .from(sourcePost)
    .where(isNull(sourcePost.accountId));

  const count = { orphan: orphanList.length, linked: 0, noMapping: 0, noAccount: 0 };

  for (const orphan of orphanList) {
    const username = usernameByShortcode.get(orphan.shortcode);
    if (!username) {
      count.noMapping++;
      continue;
    }

    const accountId = accountIdByUsername.get(username);
    if (!accountId) {
      // The account was removed from the watchlist since — pacnewport,
      // for one. Leaving the post unlinked is correct; inventing a row
      // for a deactivated account is not.
      count.noAccount++;
      continue;
    }

    if (!isDryRun) {
      await db.update(sourcePost)
        .set({ accountId })
        .where(eq(sourcePost.sourcePostId, orphan.sourcePostId));

      await db.update(event)
        .set({ sourceAccountId: accountId })
        .where(eq(event.sourcePostId, orphan.sourcePostId));
    }
    count.linked++;
  }

  console.log(
    `${count.orphan} orphaned post(s)${isDryRun ? ' (dry run)' : ''}\n`
    + `  ${count.linked} linked to an account\n`
    + `  ${count.noMapping} not in the snapshot, left alone\n`
    + `  ${count.noAccount} whose account is no longer on the watchlist, left alone`,
  );

  await pgConnection.end({ timeout: 5 });
}

void main();
