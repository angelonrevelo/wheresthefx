import { db, syncLog } from '@wheresthefx/db';
import { eq } from 'drizzle-orm';

/**
 * Sync run accounting.
 *
 * The previous ingest counted skipped rows into a local variable and then
 * never wrote it anywhere, so a run that silently dropped a third of its
 * input logged as `completed` and looked identical to a clean one. The
 * only way to notice was to read a cron logfile nobody read.
 */

export interface SyncCount {
  venue: number;
  account: number;
  post: number;
  event: number;
  subEvent: number;
  /** Rows that failed and were skipped. A completed run with errors is
   *  still a degraded run and must be visible as one. */
  error: number;
  /** Categories the extractor produced that the taxonomy does not know. */
  unknownCategory: number;
}

export function emptyCount(): SyncCount {
  return { venue: 0, account: 0, post: 0, event: 0, subEvent: 0, error: 0, unknownCategory: 0 };
}

export async function startSyncRun(): Promise<number> {
  const [row] = await db.insert(syncLog).values({ status: 'running' }).returning();
  return row.syncLogId;
}

export async function completeSyncRun(syncLogId: number, count: SyncCount): Promise<void> {
  await db.update(syncLog).set({
    status: 'completed',
    completedAt: new Date(),
    venueSyncedCount: count.venue,
    accountSyncedCount: count.account,
    postSyncedCount: count.post,
    eventSyncedCount: count.event,
    subEventSyncedCount: count.subEvent,
    errorCount: count.error,
    unknownCategoryCount: count.unknownCategory,
  }).where(eq(syncLog.syncLogId, syncLogId));
}

export async function failSyncRun(syncLogId: number, err: unknown, count: SyncCount): Promise<void> {
  await db.update(syncLog).set({
    status: 'failed',
    completedAt: new Date(),
    venueSyncedCount: count.venue,
    accountSyncedCount: count.account,
    postSyncedCount: count.post,
    eventSyncedCount: count.event,
    subEventSyncedCount: count.subEvent,
    errorCount: count.error,
    unknownCategoryCount: count.unknownCategory,
    errorMessage: err instanceof Error ? `${err.message}\n${err.stack ?? ''}`.slice(0, 4000) : String(err),
  }).where(eq(syncLog.syncLogId, syncLogId));
}
