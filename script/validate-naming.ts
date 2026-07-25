/**
 * Naming gate. Dependency-free so it can run in CI, a pre-commit hook, or `npm run check`
 * without a build step.
 *
 * Enforces the house rules from ~/.claude/skills/convention against SQL migrations and
 * TypeScript source. The headline rule is SINGULAR EVERYWHERE — including collections.
 *
 *   npm run lint:naming
 *
 * # Why a gate and not a document
 *
 * `docs/CONVENTIONS.md` carried a "Future Improvements" checklist for two of these rules
 * (`{table}_id` primary keys, no raw ORM in routes) and both stayed unchecked while the
 * schema grew. A rule that lives only in a document is a rule the next commit re-breaks.
 *
 * Deliberately a superset of tripi's `script/validate-naming.ts`: the SQL and collection
 * rules are byte-compatible so a violation means the same thing in both repos, plus three
 * checks this repo needs that tripi does not (Drizzle property names, directory names,
 * ORM imports in routes). See docs/TRIPI.md for why the two gates are kept in sync.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

interface Violation {
  file: string;
  line: number;
  text: string;
  rule: string;
}

const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'meta', 'ui']);

function walk(dir: string, extension: string[], out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, extension, out);
    else if (extension.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

function walkDir(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR.has(entry)) continue;
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    out.push(full);
    walkDir(full, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// SQL rules — identical to tripi's, so a migration means the same in both repos
// ---------------------------------------------------------------------------

const PLURAL_MEASURE =
  /^\s*"?\w*_(seconds|minutes|hours|days|weeks|months|years|units|meters|kilometers|miles|feet|inches|grams|pesos)"?\s+(integer|bigint|numeric|real|double|smallint)/i;
const BARE_PREDICATE =
  /^\s*"?(enabled|active|published|archived|locked|deleted|verified|valid|disabled)"?\s+boolean/i;
const BARE_CODE = /^\s*"?code"?\s+(text|varchar|character)/i;
const BARE_ID_PK = /^\s*"?id"?\s+(uuid|bigserial|serial|integer|bigint)\s+PRIMARY KEY/i;
const NAIVE_TIMESTAMP = /\btimestamp\b(?!tz)/i;
const IS_DELETED = /\bis_deleted\b/i;

// ---------------------------------------------------------------------------
// TypeScript rules
// ---------------------------------------------------------------------------

// Collection keys/props that AI reflexively pluralizes. Checked in .ts only, and only
// on declaration sites, so prose and third-party identifiers are left alone.
const PLURAL_COLLECTION =
  /^\s*(?:readonly\s+)?([a-z_][a-z0-9_]*?(?:s|es))\s*[?]?\s*:\s*(?:[A-Za-z_][\w.<>]*\[\]|Array<)/;

// `const events = [` / `let markers = [` — the other half of rule 22, which the type-
// annotation regex above cannot see because an array literal needs no annotation.
const PLURAL_ARRAY_LITERAL =
  /\b(?:const|let|var)\s+([a-z_][a-zA-Z0-9_]*?(?:s|es))\s*(?::\s*[^=]+)?=\s*\[/;

// Drizzle column properties mirror the SQL, so the SQL rules have to apply here too.
// `id: serial('id').primaryKey()` is the rule-1 violation the schema shipped with.
const DRIZZLE_ID_PK = /^\s*id\s*:\s*\w+\(\s*['"]id['"]\s*\).*primaryKey\(/i;
const DRIZZLE_NAIVE_TIMESTAMP = /:\s*timestamp\(\s*['"][^'"]+['"]\s*\)(?!\s*,?\s*$)/;

// A word that ends in s but is already singular. `alias` is the one that bites: the
// plural regex reads it as "alia" + "s".
const PLURAL_ALLOW = new Set([
  'address', 'status', 'progress', 'process', 'access', 'success',
  'class', 'pass', 'cross', 'series', 'gas', 'bus', 'less', 'plus',
  'alias', 'analysis', 'axis', 'basis', 'bias', 'canvas', 'census',
  'focus', 'radius', 'campus', 'lens', 'news', 'props', 'this', 'css',
]);

/** Singular directory names, per the layout in README.md. */
const PLURAL_DIR_ALLOW = new Set([
  'node_modules', 'middleware', // mass nouns, not collections
  'public', 'src', 'assets',    // `assets` is Vite's fixed convention, not ours
]);

function checkSql(file: string): Violation[] {
  const violation: Violation[] = [];
  const line = readFileSync(file, 'utf8').split('\n');
  line.forEach((text, index) => {
    if (text.trim().startsWith('--')) return;
    const at = { file, line: index + 1, text: text.trim() };
    if (PLURAL_MEASURE.test(text)) violation.push({ ...at, rule: 'measurement must be singular' });
    if (BARE_PREDICATE.test(text)) violation.push({ ...at, rule: 'boolean needs is_ prefix' });
    if (BARE_CODE.test(text)) violation.push({ ...at, rule: 'use {entity}_code, not bare code' });
    if (BARE_ID_PK.test(text)) violation.push({ ...at, rule: 'PK must be {table}_id, not id' });
    if (IS_DELETED.test(text)) violation.push({ ...at, rule: 'use deleted_at, not is_deleted' });
    if (NAIVE_TIMESTAMP.test(text) && /\b(timestamp)\s|\btimestamp\)/i.test(text)) {
      violation.push({ ...at, rule: 'use timestamptz, not timestamp' });
    }
  });
  return violation;
}

function checkTypescript(file: string): Violation[] {
  const violation: Violation[] = [];
  const line = readFileSync(file, 'utf8').split('\n');
  line.forEach((text, index) => {
    const at = { file, line: index + 1, text: text.trim() };

    for (const pattern of [PLURAL_COLLECTION, PLURAL_ARRAY_LITERAL]) {
      const match = pattern.exec(text);
      if (!match) continue;
      const name = match[1]!;
      if (PLURAL_ALLOW.has(name.toLowerCase())) continue;
      violation.push({ ...at, rule: `collection "${name}" must be singular` });
    }

    if (DRIZZLE_ID_PK.test(text)) {
      violation.push({ ...at, rule: 'PK must be {table}_id, not id' });
    }
    if (DRIZZLE_NAIVE_TIMESTAMP.test(text) && !/withTimezone/.test(text)) {
      violation.push({ ...at, rule: 'timestamp needs { withTimezone: true }' });
    }
  });
  return violation;
}

/**
 * Routes are HTTP only. A Drizzle import in a route means SQL leaked out of the DAL,
 * which is the one piece of layering that makes this codebase portable to tripi at all
 * (tripi has no ORM — its routes call `src/db/` and nothing else).
 */
function checkRouteLayering(file: string): Violation[] {
  const violation: Violation[] = [];
  const line = readFileSync(file, 'utf8').split('\n');
  line.forEach((text, index) => {
    if (!/^\s*import\b/.test(text)) return;
    if (!/from\s+['"](drizzle-orm|@wheresthefx\/db)/.test(text)) return;
    violation.push({
      file,
      line: index + 1,
      text: text.trim(),
      rule: 'no ORM in a route — query through src/db/',
    });
  });
  return violation;
}

function checkDirectoryName(dir: string): Violation[] {
  const name = basename(dir);
  if (PLURAL_DIR_ALLOW.has(name)) return [];
  if (PLURAL_ALLOW.has(name)) return [];
  if (!/(?:s|es)$/.test(name)) return [];
  return [{
    file: dir,
    line: 0,
    text: relative(repoRoot, dir),
    rule: `directory "${name}" must be singular`,
  }];
}

const sqlFile = [
  ...walk(join(repoRoot, 'package', 'db', 'migration'), ['.sql']),
];
const typescriptFile = [
  ...walk(join(repoRoot, 'app'), ['.ts', '.tsx']),
  ...walk(join(repoRoot, 'package'), ['.ts']),
  ...walk(join(repoRoot, 'script'), ['.ts']),
];
const routeFile = walk(join(repoRoot, 'app', 'api', 'src', 'route'), ['.ts']);
const directory = [
  ...walkDir(join(repoRoot, 'app')),
  ...walkDir(join(repoRoot, 'package')),
];

const violation = [
  ...sqlFile.flatMap(checkSql),
  ...typescriptFile.flatMap(checkTypescript),
  ...routeFile.flatMap(checkRouteLayering),
  ...directory.flatMap(checkDirectoryName),
];

if (violation.length === 0) {
  console.log(
    `naming ok — ${sqlFile.length} sql, ${typescriptFile.length} ts, ${directory.length} dir`,
  );
} else {
  for (const v of violation) {
    const where = v.line === 0 ? relative(repoRoot, v.file) : `${relative(repoRoot, v.file)}:${v.line}`;
    console.error(`${where}  ${v.rule}\n    ${v.text}`);
  }
  console.error(`\n${violation.length} naming violation`);
  process.exitCode = 1;
}
