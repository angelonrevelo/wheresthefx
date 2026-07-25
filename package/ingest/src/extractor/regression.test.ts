import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CATEGORY } from '@wheresthefx/core';
import { extractEvent } from './gemini.js';
import { PROMPT_VERSION } from '../prompt/extraction.js';

/**
 * Extraction regression suite.
 *
 * ## What this measures, and what it does not
 *
 * The corpus labels come from `blead/data/ground-truth-events.json`, where
 * every row carries `source: "gemini"`. They are the **previous model's
 * own output**, not human-verified truth. So this suite answers "did
 * behaviour change?", not "is it correct?". Treat a drop as a signal to
 * investigate, not proof of a bug — and treat a rise with equal suspicion.
 *
 * Building a genuinely human-labelled set is worth doing; until then, this
 * is the honest framing.
 *
 * ## Running it
 *
 * Skipped unless an extraction backend is configured, because each row is
 * a real API call (136 rows ≈ 136 calls, a few minutes and real money):
 *
 *   GEMINI_API_KEY=... npx vitest run package/ingest/src/extractor/regression
 *
 * Run it before bumping PROMPT_VERSION. Record the score in the commit.
 */

const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixture/regression-corpus.json',
);

interface CorpusRow {
  id: string;
  caption: string;
  username: string;
  expected: {
    category: string;
    venue: string | null;
    date: string | null;
    time: string | null;
  };
}

const corpus: CorpusRow[] = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

const hasBackend = Boolean(
  process.env.VERTEX_PROJECT_ID || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
);

/**
 * Minimum agreement with the previous pipeline's categories.
 *
 * The old classifier reported 77.3% on clean data. This floor is set
 * below that deliberately: the point is to catch a *collapse*, not to
 * enforce parity with output that was itself unverified.
 */
const CATEGORY_AGREEMENT_FLOOR = 0.7;

describe('regression corpus', () => {
  it('is present, balanced, and internally valid', () => {
    expect(corpus.length).toBeGreaterThan(100);

    const seen = new Set<string>();
    for (const row of corpus) {
      expect(row.id, 'duplicate fixture id').not.toBe(undefined);
      expect(seen.has(row.id), `duplicate id ${row.id}`).toBe(false);
      seen.add(row.id);
      expect(row.caption.length).toBeGreaterThan(0);
      expect(CATEGORY, `${row.id} has an off-taxonomy label`).toContain(row.expected.category);
    }
  });

  it('covers every canonical category', () => {
    const covered = new Set(corpus.map(row => row.expected.category));
    for (const category of CATEGORY) {
      expect(covered, `corpus has no ${category} examples`).toContain(category);
    }
  });
});

describe.skipIf(!hasBackend)('live extraction against the corpus', () => {
  it(
    'agrees with the previous pipeline on category at least 70% of the time',
    { timeout: 30 * 60_000 },
    async () => {
      let agreed = 0;
      let extracted = 0;
      const disagreement: string[] = [];
      const unknownCategory: string[] = [];

      for (const row of corpus) {
        const outcome = await extractEvent({
          caption: row.caption,
          username: row.username,
          postedAt: row.expected.date ?? undefined,
        });

        if (outcome.unknownCategory) unknownCategory.push(`${row.id}: ${outcome.unknownCategory}`);
        if (!outcome.result.category) continue;

        extracted++;
        if (outcome.result.category === row.expected.category) {
          agreed++;
        } else {
          disagreement.push(
            `${row.id}: expected ${row.expected.category}, got ${outcome.result.category}`,
          );
        }
      }

      const rate = extracted === 0 ? 0 : agreed / extracted;

      console.log(`\nPrompt ${PROMPT_VERSION}`);
      console.log(`Category agreement: ${(rate * 100).toFixed(1)}% (${agreed}/${extracted})`);
      if (unknownCategory.length > 0) {
        console.log(`Off-taxonomy categories returned: ${unknownCategory.join(', ')}`);
      }
      if (disagreement.length > 0) {
        console.log(`\nDisagreements:\n  ${disagreement.slice(0, 30).join('\n  ')}`);
      }

      // The model must never invent a category — that is a hard failure
      // regardless of agreement rate.
      expect(unknownCategory, 'model returned off-taxonomy categories').toEqual([]);
      expect(rate).toBeGreaterThanOrEqual(CATEGORY_AGREEMENT_FLOOR);
    },
  );
});
