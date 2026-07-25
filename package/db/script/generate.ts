/**
 * `db:generate` wrapper.
 *
 * drizzle-kit emits `timestamp with time zone`. That is exactly the same
 * type as `timestamptz` to PostgreSQL, but `script/validate-naming.ts`
 * matches on the literal spelling, so a freshly generated migration would
 * fail the naming gate through no fault of the author.
 *
 * Rather than loosening the gate — the spelling should be consistent
 * across every migration a human reads — the generated SQL is normalised
 * here, immediately after generation.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = join(packageRoot, 'migration');

execFileSync('npx', ['drizzle-kit', 'generate', ...process.argv.slice(2)], {
  cwd: packageRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

let normalized = 0;
for (const entry of readdirSync(migrationDir)) {
  if (!entry.endsWith('.sql')) continue;
  const path = join(migrationDir, entry);
  const sql = readFileSync(path, 'utf8');
  const next = sql.replaceAll(' timestamp with time zone', ' timestamptz');
  if (next !== sql) {
    writeFileSync(path, next);
    normalized++;
  }
}

if (normalized > 0) {
  console.log(`normalised timestamptz spelling in ${normalized} migration file`);
}
