import { PROMPT_VERSION, buildExtractionPrompt, type PromptInput } from '../prompt/extraction.js';
import { parseExtractionResponse } from './parse.js';
import { type ExtractionOutcome, emptyExtraction } from './type.js';
import {
  ExtractorAuthError,
  ExtractorRateLimitError,
  complete,
  loadImagePart,
  readBackendConfig,
  type BackendConfig,
} from './backend.js';

export { ExtractorAuthError, ExtractorRateLimitError } from './backend.js';

/**
 * Extract one post into structured event data.
 *
 * Provider-agnostic: whatever `EXTRACT_BASE_URL` points at. See
 * `backend.ts` for why that is an OpenAI-compatible endpoint rather than
 * a vendor SDK.
 */

export interface ExtractOption {
  /** Local image paths. Up to 4 are sent; oversize ones skipped. */
  imagePathList?: string[];
  /** Retry budget for rate limits. */
  maxRetry?: number;
  /** Injectable so callers can reuse one config across a batch. */
  config?: BackendConfig;
}

const RETRY_DELAY_MS = [15_000, 30_000, 60_000];

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export interface ExtractResult extends ExtractionOutcome {
  /** A category the model invented that the taxonomy does not cover. */
  unknownCategory: string | null;
}

export async function extractEvent(
  input: PromptInput,
  option: ExtractOption = {},
): Promise<ExtractResult> {
  const config = option.config ?? readBackendConfig();
  const prompt = buildExtractionPrompt(input);
  const postedAt = input.postedAt ? new Date(input.postedAt) : new Date();

  let imageDataUriList = option.imagePathList?.length
    ? await loadImagePart(option.imagePathList)
    : [];

  const maxRetry = option.maxRetry ?? RETRY_DELAY_MS.length;

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      const raw = await complete(config, prompt, { imageDataUriList });
      const { result, unknownCategory } = parseExtractionResponse(raw, postedAt);

      return {
        result,
        unknownCategory,
        provenance: {
          method: imageDataUriList.length > 0 ? 'ai+image' : 'ai',
          model: config.model,
          promptVersion: PROMPT_VERSION,
          extractedAt: new Date(),
        },
      };
    } catch (err) {
      // Auth failure burns quota on every subsequent call and the caller
      // needs to stop the whole run, not just this post.
      if (err instanceof ExtractorAuthError) throw err;

      if (err instanceof ExtractorRateLimitError && attempt < maxRetry) {
        const delay = RETRY_DELAY_MS[Math.min(attempt, RETRY_DELAY_MS.length - 1)];
        console.warn(`  rate limited, retrying in ${delay / 1000}s`);
        await sleep(delay);
        continue;
      }

      // One retry without images, in case an image was the problem.
      if (imageDataUriList.length > 0 && attempt < maxRetry) {
        console.warn('  retrying caption-only');
        imageDataUriList = [];
        continue;
      }

      console.error(`  extraction failed: ${err instanceof Error ? err.message : err}`);
      return {
        result: emptyExtraction(),
        unknownCategory: null,
        provenance: {
          method: 'none',
          model: config.model,
          promptVersion: PROMPT_VERSION,
          extractedAt: new Date(),
        },
      };
    }
  }

  return {
    result: emptyExtraction(),
    unknownCategory: null,
    provenance: {
      method: 'none',
      model: config.model,
      promptVersion: PROMPT_VERSION,
      extractedAt: new Date(),
    },
  };
}
