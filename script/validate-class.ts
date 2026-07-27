/**
 * Class-name gate. Dependency-free, like the copy and naming gates.
 *
 *   npm run lint:class
 *
 * # Why this exists
 *
 * `pointer-event-none` — singular — appeared fifteen times across ten
 * files. Tailwind's utility is `pointer-events-none`, plural, so every one
 * of those did nothing at all.
 *
 * One of them made the whole product unusable. The entry overlay faded to
 * `opacity-0` and stayed mounted, relying on that class to stop
 * intercepting input. It never did, so an invisible full-screen div sat on
 * top of the map and swallowed every drag and click. The map looked fine
 * and could not be moved.
 *
 * A wrong Tailwind class is silent: no error, no warning, no visual
 * difference until the one place it mattered. Neither TypeScript nor
 * ESLint sees inside a string of class names, which is why this is a
 * separate gate rather than a lint rule.
 *
 * The list is deliberately short. It holds mistakes actually made in this
 * repo, not every class Tailwind might reject — a gate that guesses gets
 * switched off.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const SCAN_ROOT = ['app/web/src'];
const EXTENSION = ['.ts', '.tsx', '.css'];

interface Rule {
  /** Matched against file text. */
  pattern: RegExp;
  correct: string;
  note: string;
}

const RULE: Rule[] = [
  {
    pattern: /pointer-event-(none|auto)\b/g,
    correct: 'pointer-events-none / pointer-events-auto',
    note: 'the property and the utility are both plural; the singular form is silently ignored',
  },
  {
    // The CSS property, in an inline style rather than a class.
    pattern: /pointer-event\s*:/g,
    correct: 'pointer-events:',
    note: 'CSS property is plural; the singular declaration is dropped by the parser',
  },
  {
    pattern: /\btransition-color\b(?!s)/g,
    correct: 'transition-colors',
    note: 'Tailwind names this one plural',
  },
  {
    pattern: /\bflex-column\b/g,
    correct: 'flex-col',
    note: 'Tailwind abbreviates it',
  },
];

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (EXTENSION.some(ext => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const fileList: string[] = [];
for (const root of SCAN_ROOT) walk(join(repoRoot, root), fileList);

interface Violation {
  file: string;
  line: number;
  found: string;
  rule: Rule;
}

const violationList: Violation[] = [];

for (const file of fileList) {
  const text = readFileSync(file, 'utf8');
  const lineList = text.split('\n');

  for (const rule of RULE) {
    lineList.forEach((line, index) => {
      // Reset between lines: the regexes are global and carry lastIndex.
      rule.pattern.lastIndex = 0;
      const match = rule.pattern.exec(line);
      if (!match) return;
      violationList.push({
        file: relative(repoRoot, file),
        line: index + 1,
        found: match[0],
        rule,
      });
    });
  }
}

if (violationList.length > 0) {
  console.error(`class gate: ${violationList.length} violation(s)\n`);
  for (const violation of violationList) {
    console.error(`  ${violation.file}:${violation.line}`);
    console.error(`    found "${violation.found}" — use ${violation.rule.correct}`);
    console.error(`    ${violation.rule.note}\n`);
  }
  process.exit(1);
}

console.log(`class ok — ${fileList.length} file(s) scanned, no silently dead class names`);
