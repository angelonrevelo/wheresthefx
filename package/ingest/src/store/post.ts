import { db, sourcePost } from '@wheresthefx/db';

/**
 * Source-post persistence.
 *
 * `raw_extraction` holds the full extractor response. It is the only way
 * to diagnose a prompt regression after the fact rather than guessing:
 * paired with `prompt_version` and `extraction_model`, a bad batch can be
 * traced to the exact prompt and model that produced it. The old ingest
 * explicitly discarded this ("skip large JSON to avoid memory issues"),
 * which is why the March extraction failures could never be explained.
 */

export interface PostDraft {
  accountId: number | null;
  shortcode: string;
  postUrl: string;
  postType: string;
  caption: string | null;
  postedAt: Date | null;
  imageUrl: string | null;
  imageUrlList: string[];
  likeCount: number;
  commentCount: number;
  isEvent: boolean;
  rawExtraction: unknown;
  extractionMethod: string;
  extractionModel: string | null;
  promptVersion: string | null;
  extractedAt: Date;
  aiConfidence: number | null;
}

/** Insert or update a post, keyed on shortcode. */
export async function savePost(draft: PostDraft): Promise<number> {
  const value = {
    accountId: draft.accountId,
    shortcode: draft.shortcode,
    postUrl: draft.postUrl,
    postType: draft.postType,
    caption: draft.caption,
    postedAt: draft.postedAt,
    imageUrl: draft.imageUrl,
    imageUrlList: draft.imageUrlList,
    likeCount: draft.likeCount,
    commentCount: draft.commentCount,
    isEvent: draft.isEvent,
    rawExtraction: draft.rawExtraction,
    extractionMethod: draft.extractionMethod,
    extractionModel: draft.extractionModel,
    promptVersion: draft.promptVersion,
    extractedAt: draft.extractedAt,
    aiConfidence: draft.aiConfidence,
  };

  const [row] = await db.insert(sourcePost)
    .values(value)
    .onConflictDoUpdate({ target: sourcePost.shortcode, set: value })
    .returning({ sourcePostId: sourcePost.sourcePostId });

  return row.sourcePostId;
}
