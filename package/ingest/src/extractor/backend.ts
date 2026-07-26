import { readFile, stat } from 'node:fs/promises';

/**
 * Model backend, over the OpenAI-compatible chat-completions shape.
 *
 * ## Why this shape rather than a vendor SDK
 *
 * Adopted from tripi's `apps/api/eval/persona/model.ts`. Raw `fetch`
 * against `/chat/completions` works unchanged with OpenAI, OpenRouter,
 * Groq, Together, a local llama.cpp server, and Gemini's own
 * OpenAI-compatibility endpoint. Switching provider is one env var
 * rather than a code change, and there is no SDK to keep current.
 *
 * This replaced a two-branch implementation carrying both
 * `@google/generative-ai` and `@google-cloud/vertexai`, which had to be
 * kept in sync and could only ever talk to Google.
 *
 *   EXTRACT_BASE_URL   default https://api.openai.com/v1
 *   EXTRACT_API_KEY    or OPENAI_API_KEY
 *   EXTRACT_MODEL      default gpt-4o-mini
 */

export interface BackendConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Thrown for auth failures, which must abort a run rather than retry. */
export class ExtractorAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractorAuthError';
  }
}

/** Thrown on 429, so the caller can back off rather than hammer. */
export class ExtractorRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractorRateLimitError';
  }
}

export function readBackendConfig(): BackendConfig {
  const apiKey = process.env.EXTRACT_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!apiKey) {
    throw new ExtractorAuthError(
      'No extraction key. Set EXTRACT_API_KEY (or OPENAI_API_KEY). ' +
      'Point EXTRACT_BASE_URL at any OpenAI-compatible endpoint.',
    );
  }
  return {
    baseUrl: (process.env.EXTRACT_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey,
    model: process.env.EXTRACT_MODEL || 'gpt-4o-mini',
  };
}

const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTE = 4 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** Image parts as data URIs, skipping anything missing or oversize. */
export async function loadImagePart(pathList: string[]): Promise<string[]> {
  const partList: string[] = [];

  for (const path of pathList) {
    if (partList.length >= MAX_IMAGE_COUNT) break;

    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    const mimeType = MIME_BY_EXTENSION[extension];
    if (!mimeType) continue;

    try {
      const info = await stat(path);
      if (info.size > MAX_IMAGE_BYTE) continue;
      const buffer = await readFile(path);
      partList.push(`data:${mimeType};base64,${buffer.toString('base64')}`);
    } catch {
      // Missing or unreadable: fall back to caption-only.
    }
  }

  return partList;
}

interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
}

export interface CompletionOption {
  /** Data URIs from `loadImagePart`. */
  imageDataUriList?: string[];
  temperature?: number;
}

/**
 * One completion, returning the raw assistant message.
 *
 * `response_format: json_object` is requested because the prompt demands
 * JSON. It is not trusted — the parser still strips code fences and
 * tolerates malformed output, because not every compatible endpoint
 * honours the flag.
 */
export interface CompletionResult {
  content: string;
  /** Reported by the provider. Zero when the endpoint omits it. */
  inputToken: number;
  outputToken: number;
}

export async function complete(
  config: BackendConfig,
  prompt: string,
  option: CompletionOption = {},
): Promise<CompletionResult> {
  const partList: ContentPart[] = [{ type: 'text', text: prompt }];

  for (const dataUri of option.imageDataUriList ?? []) {
    // `high` detail: event posters carry the date and time as small text,
    // and `low` downsamples enough to lose it.
    partList.push({ type: 'image_url', image_url: { url: dataUri, detail: 'high' } });
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: partList }],
      // Extraction is a reading task, not a writing one: near-zero
      // temperature so the same caption yields the same fields.
      temperature: option.temperature ?? 0.1,
      response_format: { type: 'json_object' },
    }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new ExtractorAuthError(`Model endpoint rejected the key (${response.status})`);
  }
  if (response.status === 429) {
    throw new ExtractorRateLimitError('Model endpoint rate limited (429)');
  }
  if (!response.ok) {
    throw new Error(`Model endpoint ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const payload = await response.json() as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    content: String(payload?.choices?.[0]?.message?.content ?? '').trim(),
    // Measured, not estimated. Spend was previously invisible.
    inputToken: payload?.usage?.prompt_tokens ?? 0,
    outputToken: payload?.usage?.completion_tokens ?? 0,
  };
}
