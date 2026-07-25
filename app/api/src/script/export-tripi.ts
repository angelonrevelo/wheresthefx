/**
 * Dump the tripi feed to stdout, so tripi can be fed from a file when this API is not
 * reachable from wherever its ingest runs.
 *
 *   npm run export:tripi -- place                    # the venue catalog
 *   npm run export:tripi -- event                    # upcoming events
 *   npm run export:tripi -- event --since 2026-08-01
 *   npm run export:tripi -- event --jsonl            # one draft per line
 *   npm run export:tripi -- place --skipped          # only what was NOT emitted, and why
 *
 * ## Why a CLI as well as the endpoint
 *
 * The endpoint is the steady-state path. This exists for the two cases it does not cover: the
 * first load, where somebody wants to eyeball a few thousand drafts before letting them into a
 * live catalog, and any environment where tripi's ingest host cannot reach this API. Both are
 * file-shaped, and `--jsonl` is the shape tripi's CSV/JSONL feeds already read.
 *
 * `--skipped` answers "why is this venue missing" without a database session. Same data the
 * envelope carries; it is just the half people actually go looking for.
 */

import '@wheresthefx/db/env';
import { toDraftExport, toEventDraft, toPlaceDraft } from '@wheresthefx/core';
import { findEventForExport, findVenueForExport } from '../db/tripiExport.js';
import { sql } from '@wheresthefx/db';

function readFlag(argument: string[], name: string): string | undefined {
  const at = argument.indexOf(name);
  if (at === -1 || at + 1 >= argument.length) return undefined;
  return argument[at + 1];
}

function usage(): never {
  console.error(
    [
      'usage:',
      '  npm run export:tripi -- place [--jsonl] [--skipped]',
      '  npm run export:tripi -- event [--since YYYY-MM-DD] [--jsonl] [--skipped]',
    ].join('\n'),
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const argument = process.argv.slice(2);
  const mode = argument[0];
  if (mode !== 'place' && mode !== 'event') usage();

  const since = readFlag(argument, '--since');
  if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    console.error(`--since must be YYYY-MM-DD, got "${since}"`);
    process.exit(1);
  }

  const asJsonl = argument.includes('--jsonl');
  const skippedOnly = argument.includes('--skipped');

  const result = mode === 'place'
    ? toDraftExport((await findVenueForExport()).map((one) => toPlaceDraft(one)), new Date())
    : toDraftExport((await findEventForExport(since)).map((one) => toEventDraft(one)), new Date());

  if (skippedOnly) {
    for (const one of result.skipped) {
      process.stdout.write(`${one.external_ref}\t${one.skip_reason}\n`);
    }
    // To stderr so it does not land in a file being piped to.
    console.error(`${result.skipped.length} skipped, ${result.draft_count} emitted`);
    return;
  }

  if (asJsonl) {
    for (const one of result.draft) process.stdout.write(`${JSON.stringify(one)}\n`);
    console.error(`${result.draft_count} draft, ${result.skipped.length} skipped`);
    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  console.error(`${result.draft_count} draft, ${result.skipped.length} skipped`);
}

main()
  .then(async () => {
    // The postgres.js pool holds the process open otherwise, so a piped run never terminates.
    await sql.end({ timeout: 5 });
  })
  .catch(async (err) => {
    console.error(err);
    await sql.end({ timeout: 5 });
    process.exitCode = 1;
  });
