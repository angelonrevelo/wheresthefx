import { createHash } from 'node:crypto';
import { db, sourcePost } from '@wheresthefx/db';
import { inArray } from 'drizzle-orm';

/**
 * Extraction cost control.
 *
 * Two mechanisms, in order of how much they save:
 *
 * 1. **Skip already-extracted posts.** The scraper fetches the last N
 *    posts per account every run, but almost all of them were extracted
 *    last run and have not changed. Re-reading them is pure waste: at
 *    4,240 posts a pass and four passes a day, extracting everything
 *    every time costs roughly $435/month. Extracting only genuinely new
 *    or edited posts brings that under $15.
 *
 * 2. **Caption hashing**, so an *edited* post is re-extracted. A venue
 *    correcting a date in the caption must not be ignored, which a plain
 *    shortcode check would do.
 */

/** Prices in USD per token. Keep in step with the provider's page. */
const MODEL_PRICE: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
  'gpt-4o': { input: 2.50 / 1_000_000, output: 10.00 / 1_000_000 },
  'gpt-4.1-mini': { input: 0.40 / 1_000_000, output: 1.60 / 1_000_000 },
};

/** Assumed when the model is unknown, so an estimate is never silently zero. */
const FALLBACK_PRICE = { input: 1.0 / 1_000_000, output: 4.0 / 1_000_000 };

export interface TokenUsage {
  inputToken: number;
  outputToken: number;
}

export function estimateCost(model: string, usage: TokenUsage): number {
  const price = MODEL_PRICE[model] ?? FALLBACK_PRICE;
  return usage.inputToken * price.input + usage.outputToken * price.output;
}

/** Running total for one pipeline run. */
export class CostMeter {
  private inputToken = 0;
  private outputToken = 0;
  private callCount = 0;
  private skippedCount = 0;

  constructor(private readonly model: string) {}

  record(usage: TokenUsage): void {
    this.inputToken += usage.inputToken;
    this.outputToken += usage.outputToken;
    this.callCount++;
  }

  recordSkip(): void {
    this.skippedCount++;
  }

  get totalCost(): number {
    return estimateCost(this.model, {
      inputToken: this.inputToken,
      outputToken: this.outputToken,
    });
  }

  /** What those skips would have cost, at this run's average call size. */
  get savedCost(): number {
    if (this.callCount === 0) return 0;
    const perCall = this.totalCost / this.callCount;
    return perCall * this.skippedCount;
  }

  summary(): string {
    return [
      `${this.callCount} extraction(s), ${this.skippedCount} skipped`,
      `${this.inputToken.toLocaleString()} in + ${this.outputToken.toLocaleString()} out token`,
      `$${this.totalCost.toFixed(4)} spent`,
      this.skippedCount > 0 ? `~$${this.savedCost.toFixed(4)} saved by skipping` : null,
    ].filter(Boolean).join(' | ');
  }
}

/** Identifies a caption's content, so an edit invalidates the cache. */
export function captionHash(caption: string | null | undefined): string {
  return createHash('sha256').update(caption ?? '').digest('hex').slice(0, 16);
}

export interface ExtractedMarker {
  shortcode: string;
  captionHash: string;
  promptVersion: string | null;
}

/**
 * Which of these shortcodes have already been extracted, and with what.
 *
 * One query for the whole batch rather than one per post.
 */
export async function loadExtractedMarker(
  shortcodeList: string[],
): Promise<Map<string, ExtractedMarker>> {
  if (shortcodeList.length === 0) return new Map();

  const rowList = await db
    .select({
      shortcode: sourcePost.shortcode,
      caption: sourcePost.caption,
      promptVersion: sourcePost.promptVersion,
      extractedAt: sourcePost.extractedAt,
    })
    .from(sourcePost)
    .where(inArray(sourcePost.shortcode, shortcodeList));

  const markerByShortcode = new Map<string, ExtractedMarker>();
  for (const row of rowList) {
    // A row with no extractedAt was stored but never read by a model.
    if (!row.extractedAt) continue;
    markerByShortcode.set(row.shortcode, {
      shortcode: row.shortcode,
      captionHash: captionHash(row.caption),
      promptVersion: row.promptVersion,
    });
  }
  return markerByShortcode;
}

/**
 * Whether a post needs extracting.
 *
 * Re-extracts when the caption changed (an edit, often a corrected date)
 * or when the prompt has been revised since — a prompt bump is exactly
 * when old results are worth recomputing.
 */
export function needsExtraction(
  marker: ExtractedMarker | undefined,
  caption: string | null,
  currentPromptVersion: string,
): { needed: boolean; reason: string } {
  if (!marker) return { needed: true, reason: 'not seen before' };
  if (marker.captionHash !== captionHash(caption)) {
    return { needed: true, reason: 'caption edited' };
  }
  if (marker.promptVersion !== currentPromptVersion) {
    return { needed: true, reason: `prompt ${marker.promptVersion ?? 'none'} -> ${currentPromptVersion}` };
  }
  return { needed: false, reason: 'unchanged' };
}
