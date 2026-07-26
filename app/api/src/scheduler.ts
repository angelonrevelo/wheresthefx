import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRepoRoot } from '@wheresthefx/core/repo';

/**
 * In-process ingest scheduler.
 *
 * ## Why this exists
 *
 * The old deployment was two long-running processes plus a cron entry
 * that spawned a third on a timer. This collapses that to one supervised
 * service: the API runs the schedule itself, so there is nothing to
 * register in crontab and nothing that can silently stop being
 * registered — which is one of the ways the previous pipeline died
 * quietly.
 *
 * ## Why the scrape is still a child process
 *
 * It drives Playwright, and Chromium is multi-process by design: no
 * arrangement of our code makes a browser run inside this one. Given a
 * child is unavoidable, it is better to make it explicit and isolated —
 * a scraper that segfaults or leaks then cannot take the API down with
 * it, and its memory is reclaimed by exit rather than by hoping.
 *
 * So: one always-on process, plus a short-lived child while a scrape is
 * actually running.
 */

export interface SchedulerOption {
  /** Hours between runs. Zero or negative disables the scheduler. */
  intervalHour: number;
  /** Delay before the first run, so startup is not competing with it. */
  initialDelayMinute?: number;
  /** Repo root, for resolving the command. */
  cwd?: string;
}

/** Guards against a slow run overlapping the next tick. */
let isRunning = false;

function runScrape(cwd: string): Promise<number> {
  return new Promise<number>((resolveRun) => {
    let exitCode = 0;
    const child = spawn(
      'npx',
      ['tsx', 'package/ingest/src/command/scrape.ts', '--limit', '40'],
      {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      },
    );

    child.stdout?.on('data', chunk => process.stdout.write(`[ingest] ${chunk}`));
    child.stderr?.on('data', chunk => process.stderr.write(`[ingest] ${chunk}`));

    // Never rejects. A failed scrape is logged to sync_log by the child
    // itself; it must not become an unhandled rejection up here.
    child.on('close', (code) => {
      exitCode = code ?? 0;
      if (exitCode !== 0) console.error(`[ingest] exited ${exitCode}`);
      resolveRun(exitCode);
    });
    child.on('error', (err) => {
      console.error('[ingest] could not start:', err.message);
      exitCode = 1;
      resolveRun(exitCode);
    });
  });
}

async function tick(cwd: string): Promise<void> {
  if (isRunning) {
    console.log('[ingest] previous run still going, skipping this tick');
    return;
  }
  isRunning = true;
  const startedAt = Date.now();
  try {
    const exitCode = await runScrape(cwd);
    const elapsedSecond = Math.round((Date.now() - startedAt) / 1000);
    // Reporting "finished" for a run that exited non-zero is how this
    // looked healthy while failing every tick.
    console.log(
      exitCode === 0
        ? `[ingest] finished in ${elapsedSecond}s`
        : `[ingest] FAILED after ${elapsedSecond}s (exit ${exitCode})`,
    );
  } catch (err) {
    // Belt and braces: runScrape never rejects, but a throw here would
    // otherwise reach the process-level handler and drain the API.
    console.error('[ingest] scheduler error:', err);
  } finally {
    isRunning = false;
  }
}

/**
 * Start the scheduler. Returns a stop function for graceful shutdown.
 *
 * Returns null when disabled, so the caller can report that plainly
 * rather than silently doing nothing.
 */
export function startScheduler(option: SchedulerOption): (() => void) | null {
  if (!Number.isFinite(option.intervalHour) || option.intervalHour <= 0) return null;

  // Anchored to this module, not the cwd. pm2 starts the process from
  // the repo root while `npm run dev` starts it from app/api, so any
  // fixed number of `..` is wrong in one of those cases — it resolved to
  // `/` under pm2 and the scheduler failed on every tick, silently.
  const cwd = option.cwd ?? findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const intervalMs = option.intervalHour * 60 * 60 * 1000;
  const initialDelayMs = (option.initialDelayMinute ?? 5) * 60 * 1000;

  const initial = setTimeout(() => void tick(cwd), initialDelayMs);
  const repeating = setInterval(() => void tick(cwd), intervalMs);

  // unref so a pending timer never holds the process open during shutdown.
  initial.unref();
  repeating.unref();

  return () => {
    clearTimeout(initial);
    clearInterval(repeating);
  };
}
