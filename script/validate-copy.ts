/**
 * Copy gate. Dependency-free, like the naming gate, so it runs in `npm run check` with no build.
 *
 * Right now it enforces one rule: **no em dash in anything a user reads.** They read as
 * machine-written. Comments keep theirs, because the em dash is the house style throughout
 * this source and nobody but us reads it.
 *
 *   npm run lint:copy
 *
 * # Telling copy from comment
 *
 * The bundler strips comments, so the exact check is "grep the built bundle" -- but that needs
 * a build, and a gate people run before pushing must be instant. So this scans source and skips
 * comments itself, with a small scanner that tracks strings, template literals and both comment
 * forms. Regex alone would flag every legitimate comment em dash and get ignored within a day.
 *
 * Ported from tripi's `script/validate-copy.ts` unchanged apart from SCAN_ROOT, so a string that
 * passes here passes there. See docs/TRIPI.md.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Only the web app: this is about what a person reads on screen. The API's user-facing
 * surface is its error strings, which `docs/API.md` holds to the same rule by hand.
 */
const SCAN_ROOT = ['app/web/src'];
const SCAN_FILE = ['.ts', '.tsx'];

/** Vendored shadcn primitives, same carve-out as eslint.config.js. */
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'ui']);

const EM_DASH = '—';

interface Violation {
  file: string;
  line: number;
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_FILE.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

/**
 * Replace every comment with spaces, keeping byte offsets so line numbers stay honest.
 *
 * Deliberately conservative about what it treats as a string: a regex literal containing a
 * quote would confuse a naive scanner into thinking a string is open and swallowing the rest of
 * the file. Since a missed comment only costs a false positive, and a swallowed file costs a
 * silent miss, this errs toward reporting.
 */
function blankComment(source: string): string {
  let out = '';
  let at = 0;
  type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  let mode: Mode = 'code';

  while (at < source.length) {
    const two = source.slice(at, at + 2);
    const one = source[at]!;

    if (mode === 'code') {
      if (two === '//') { mode = 'line'; out += '  '; at += 2; continue; }
      if (two === '/*') { mode = 'block'; out += '  '; at += 2; continue; }
      if (one === "'") mode = 'single';
      else if (one === '"') mode = 'double';
      else if (one === '`') mode = 'template';
      out += one; at += 1; continue;
    }

    if (mode === 'line') {
      if (one === '\n') { mode = 'code'; out += '\n'; } else out += ' ';
      at += 1; continue;
    }

    if (mode === 'block') {
      if (two === '*/') { mode = 'code'; out += '  '; at += 2; continue; }
      out += one === '\n' ? '\n' : ' ';
      at += 1; continue;
    }

    // Inside a string: honour escapes so \' does not end it early.
    if (one === '\\') { out += source.slice(at, at + 2); at += 2; continue; }
    if ((mode === 'single' && one === "'") || (mode === 'double' && one === '"')
      || (mode === 'template' && one === '`')) mode = 'code';
    out += one; at += 1;
  }
  return out;
}

const violation: Violation[] = [];
let fileCount = 0;

for (const root of SCAN_ROOT) {
  for (const file of walk(join(repoRoot, root))) {
    fileCount += 1;
    const source = readFileSync(file, 'utf8');
    if (!source.includes(EM_DASH)) continue;

    const stripped = blankComment(source);
    stripped.split('\n').forEach((line, index) => {
      if (!line.includes(EM_DASH)) return;
      violation.push({
        file: relative(repoRoot, file).replace(/\\/g, '/'),
        line: index + 1,
        text: source.split('\n')[index]!.trim().slice(0, 100),
      });
    });
  }
}

if (violation.length > 0) {
  console.error(`\ncopy: ${violation.length} em dash(es) in text a user reads\n`);
  for (const it of violation) {
    console.error(`  ${it.file}:${it.line}`);
    console.error(`    ${it.text}`);
  }
  console.error(
    '\nRewrite rather than swapping for a hyphen. An em dash usually joins two clauses, so a'
    + '\nhyphen leaves a sentence that reads like a typo. Use a full stop, a comma, parentheses,'
    + '\nor the middle dot the app already uses as a separator. Comments may keep theirs.\n',
  );
  process.exit(1);
}

console.log(`copy ok — ${fileCount} ts scanned, no em dash in user-facing text`);
