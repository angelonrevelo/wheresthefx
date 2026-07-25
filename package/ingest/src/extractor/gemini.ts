import { PROMPT_VERSION, buildExtractionPrompt, type PromptInput } from '../prompt/extraction.js';
import { parseExtractionResponse } from './parse.js';
import { type ExtractionOutcome, emptyExtraction } from './type.js';

/**
 * Gemini-backed event extraction.
 *
 * Two backends are supported and chosen from the environment:
 *
 * - `VERTEX_PROJECT_ID` set → Vertex AI (`@google-cloud/vertexai`)
 * - else `GEMINI_API_KEY` / `GOOGLE_API_KEY` → AI Studio
 *   (`@google/generative-ai`)
 *
 * Both SDKs are imported dynamically so only the one actually in use has
 * to be installed.
 */

export interface GeminiConfig {
  model?: string;
  /** Local image paths to inline. Up to 4 are sent; oversize ones skipped. */
  imagePathList?: string[];
  /** Retry budget for 429s. */
  maxRetry?: number;
}

const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTE = 4 * 1024 * 1024;
const RETRY_DELAY_MS = [15_000, 30_000, 60_000];

/** Thrown for auth failures, which must abort the run rather than retry. */
export class ExtractorAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractorAuthError';
  }
}

const AUTH_SIGNAL = [
  'API_KEY_INVALID',
  'API key expired',
  'PERMISSION_DENIED',
  'UNAUTHENTICATED',
  '403',
];

function isAuthFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return AUTH_SIGNAL.some(signal => message.includes(signal));
}

function isRateLimit(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('429') || message.toLowerCase().includes('resource_exhausted');
}

interface GenerativeBackend {
  readonly model: string;
  generate(prompt: string, imagePartList: InlineImage[]): Promise<string>;
}

interface InlineImage {
  mimeType: string;
  data: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** Read up to `MAX_IMAGE_COUNT` images, skipping any that are too large. */
async function loadImage(pathList: string[]): Promise<InlineImage[]> {
  const { readFile, stat } = await import('node:fs/promises');
  const loaded: InlineImage[] = [];

  for (const path of pathList) {
    if (loaded.length >= MAX_IMAGE_COUNT) break;

    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    const mimeType = MIME_BY_EXTENSION[extension];
    if (!mimeType) continue;

    try {
      const info = await stat(path);
      if (info.size > MAX_IMAGE_BYTE) {
        console.warn(`  Skipping ${path}: ${(info.size / 1024 / 1024).toFixed(1)}MB exceeds 4MB`);
        continue;
      }
      const buffer = await readFile(path);
      loaded.push({ mimeType, data: buffer.toString('base64') });
    } catch {
      // Missing or unreadable — fall back to caption-only.
    }
  }

  return loaded;
}

async function createVertexBackend(model: string): Promise<GenerativeBackend> {
  const { VertexAI } = await import('@google-cloud/vertexai');
  const client = new VertexAI({
    project: process.env.VERTEX_PROJECT_ID!,
    location: process.env.VERTEX_LOCATION || 'us-central1',
  });
  const generativeModel = client.getGenerativeModel({
    model,
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  });

  return {
    model,
    async generate(prompt, imagePartList) {
      const part = [
        ...imagePartList.map(image => ({ inlineData: image })),
        { text: prompt },
      ];
      const response = await generativeModel.generateContent({
        contents: [{ role: 'user', parts: part }],
      });
      return response.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    },
  };
}

async function createStudioBackend(model: string, apiKey: string): Promise<GenerativeBackend> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const client = new GoogleGenerativeAI(apiKey);
  const generativeModel = client.getGenerativeModel({
    model,
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  });

  return {
    model,
    async generate(prompt, imagePartList) {
      const part = [
        ...imagePartList.map(image => ({ inlineData: image })),
        { text: prompt },
      ];
      const response = await generativeModel.generateContent(part);
      return response.response.text();
    },
  };
}

/** Resolve a backend from the environment, or throw explaining what is missing. */
export async function createBackend(model = DEFAULT_MODEL): Promise<GenerativeBackend> {
  if (process.env.VERTEX_PROJECT_ID) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.VERTEX_SERVICE_ACCOUNT_JSON) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.VERTEX_SERVICE_ACCOUNT_JSON;
    }
    return createVertexBackend(model);
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey) return createStudioBackend(model, apiKey);

  throw new ExtractorAuthError(
    'No extraction backend configured. Set VERTEX_PROJECT_ID (Vertex AI) ' +
    'or GEMINI_API_KEY / GOOGLE_API_KEY (AI Studio).',
  );
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Extract one post.
 *
 * Falls back to caption-only if an image-bearing call fails, and records
 * which path produced the result so a quality regression can later be
 * attributed to the right method, model, and prompt version.
 */
export async function extractEvent(
  input: PromptInput,
  config: GeminiConfig = {},
): Promise<ExtractionOutcome & { unknownCategory: string | null }> {
  const model = config.model ?? DEFAULT_MODEL;
  const backend = await createBackend(model);
  const prompt = buildExtractionPrompt(input);
  const postedAt = input.postedAt ? new Date(input.postedAt) : new Date();

  const imagePartList = config.imagePathList?.length
    ? await loadImage(config.imagePathList)
    : [];

  const maxRetry = config.maxRetry ?? RETRY_DELAY_MS.length;

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      const raw = await backend.generate(prompt, imagePartList);
      const { result, unknownCategory } = parseExtractionResponse(raw, postedAt);

      return {
        result,
        unknownCategory,
        provenance: {
          method: imagePartList.length > 0 ? 'ai+image' : 'ai',
          model,
          promptVersion: PROMPT_VERSION,
          extractedAt: new Date(),
        },
      };
    } catch (err) {
      // Auth failures are terminal — retrying burns quota and the caller
      // needs to stop the whole run, not just this post.
      if (isAuthFailure(err)) {
        throw new ExtractorAuthError(err instanceof Error ? err.message : String(err));
      }

      if (isRateLimit(err) && attempt < maxRetry) {
        const delay = RETRY_DELAY_MS[Math.min(attempt, RETRY_DELAY_MS.length - 1)];
        console.warn(`  Rate limited, retrying in ${delay / 1000}s...`);
        await sleep(delay);
        continue;
      }

      // One retry without images, in case the image was the problem.
      if (imagePartList.length > 0 && attempt < maxRetry) {
        imagePartList.length = 0;
        continue;
      }

      console.error('  Extraction failed:', err instanceof Error ? err.message : err);
      return {
        result: emptyExtraction(),
        unknownCategory: null,
        provenance: {
          method: 'none',
          model,
          promptVersion: PROMPT_VERSION,
          extractedAt: new Date(),
        },
      };
    }
  }

  return {
    result: emptyExtraction(),
    unknownCategory: null,
    provenance: { method: 'none', model, promptVersion: PROMPT_VERSION, extractedAt: new Date() },
  };
}
