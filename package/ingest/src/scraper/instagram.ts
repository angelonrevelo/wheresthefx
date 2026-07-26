import type { Page } from 'playwright';
import { IG_APP_ID, jitteredDelay } from './stealth.js';

/**
 * Instagram post fetching.
 *
 * Uses the private v1 REST endpoint rather than the public GraphQL one.
 * That is deliberate and was verified against the live site: `/api/v1/`
 * serves public profiles **without authentication** and needs only the
 * `X-IG-App-ID` header, whereas GraphQL requires a `doc_id` that
 * Instagram rotates every two to four weeks. The unauthenticated path is
 * both simpler and far more durable.
 *
 * Requests run inside `page.evaluate` with `credentials: 'include'` so
 * they carry the browser context's cookies and origin, rather than
 * looking like a bare Node fetch from an unrelated IP.
 */

export interface RawPost {
  shortcode: string;
  postUrl: string;
  caption: string | null;
  imageUrlList: string[];
  videoUrl: string | null;
  postType: 'image' | 'video' | 'carousel' | 'reel';
  postedAt: Date | null;
  likeCount: number;
  commentCount: number;
  taggedLocation: string | null;
  hashtagList: string[];
  mentionList: string[];
}

/** Media type codes returned by the v1 API. */
const MEDIA_IMAGE = 1;
const MEDIA_VIDEO = 2;
const MEDIA_CAROUSEL = 8;

/** Unix seconds vs milliseconds, without guessing wrong for 2001-2286. */
function toDate(takenAt: unknown): Date | null {
  if (typeof takenAt !== 'number' || !Number.isFinite(takenAt)) return null;
  const ms = takenAt < 1e12 ? takenAt * 1000 : takenAt;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

function extractToken(caption: string | null, pattern: RegExp): string[] {
  if (!caption) return [];
  return [...new Set(caption.match(pattern) ?? [])];
}

/** Every image on a post, including each frame of a carousel. */
function collectImageUrl(node: Record<string, unknown>): string[] {
  const urlList: string[] = [];

  const push = (value: unknown) => {
    if (typeof value === 'string' && value.startsWith('http')) urlList.push(value);
  };

  const candidateList = (node.image_versions2 as { candidates?: { url?: string }[] } | undefined)?.candidates;
  push(candidateList?.[0]?.url);
  push(node.display_url);

  const carousel = node.carousel_media;
  if (Array.isArray(carousel)) {
    for (const child of carousel) {
      const childCandidate = (child?.image_versions2 as { candidates?: { url?: string }[] } | undefined)?.candidates;
      push(childCandidate?.[0]?.url);
    }
  }

  return [...new Set(urlList)];
}

/** Parse one v1 feed item; null when it is not a usable post. */
export function parsePostNode(node: Record<string, unknown>): RawPost | null {
  const shortcode = (node.code ?? node.shortcode) as string | undefined;
  if (!shortcode || typeof shortcode !== 'string') return null;

  const caption = ((node.caption as { text?: string } | null)?.text ?? null) as string | null;

  const mediaType = node.media_type;
  let postType: RawPost['postType'] = 'image';
  if (mediaType === MEDIA_CAROUSEL) postType = 'carousel';
  else if (mediaType === MEDIA_VIDEO) {
    postType = node.product_type === 'clips' ? 'reel' : 'video';
  } else if (mediaType !== MEDIA_IMAGE && Array.isArray(node.carousel_media)) {
    postType = 'carousel';
  }

  const videoVersionList = node.video_versions as { url?: string }[] | undefined;

  return {
    shortcode,
    postUrl: `https://www.instagram.com/p/${shortcode}/`,
    caption,
    imageUrlList: collectImageUrl(node),
    videoUrl: videoVersionList?.[0]?.url ?? null,
    postType,
    postedAt: toDate(node.taken_at),
    likeCount: typeof node.like_count === 'number' ? node.like_count : 0,
    commentCount: typeof node.comment_count === 'number' ? node.comment_count : 0,
    taggedLocation: ((node.location as { name?: string } | null)?.name ?? null) as string | null,
    // Unicode range covers accented characters common in Filipino tags.
    hashtagList: extractToken(caption, /#[\wÀ-ɏ]+/g),
    mentionList: extractToken(caption, /@[\w.]+/g),
  };
}

/**
 * Resolve a username to Instagram's numeric user id.
 *
 * This call is rate-limited far more aggressively than the feed itself,
 * which is why the id is cached on `source_account.ig_user_id` and this
 * is skipped entirely on subsequent runs.
 */
export async function resolveUserId(page: Page, username: string): Promise<string | null> {
  try {
    const result: { error: string | null; userId: string | null } = await page.evaluate(
      async ({ username, appId }) => {
        const response = await fetch(
          `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
          { headers: { 'X-IG-App-ID': appId }, credentials: 'include' },
        );
        if (!response.ok) {
          return { error: `HTTP ${response.status}`, userId: null as string | null };
        }
        const data = await response.json() as { data?: { user?: { id?: string } } };
        return { error: null as string | null, userId: data?.data?.user?.id ?? null };
      },
      { username, appId: IG_APP_ID },
    );

    if (result.error) {
      console.warn(`  profile lookup for @${username}: ${result.error}`);
      return null;
    }
    return result.userId;
  } catch (err) {
    console.warn(`  profile lookup for @${username} failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export interface FetchOption {
  maxPost?: number;
  /** Posts older than this are not worth extracting. */
  skipOlderThanDay?: number;
}

/** Indicates Instagram is rate-limiting or blocking; the caller must back off. */
export class InstagramBlockedError extends Error {
  constructor(readonly status: number) {
    super(`Instagram returned ${status}`);
    this.name = 'InstagramBlockedError';
  }
}

/**
 * Fetch recent posts for one account.
 *
 * Paginates via `max_id` until Instagram says there is no more, the
 * requested count is reached, or posts fall outside the age window.
 */
export async function fetchRecentPost(
  page: Page,
  userId: string,
  option: FetchOption = {},
): Promise<RawPost[]> {
  const maxPost = option.maxPost ?? 30;
  const skipOlderThanDay = option.skipOlderThanDay ?? 90;
  const oldestAllowed = Date.now() - skipOlderThanDay * 24 * 60 * 60 * 1000;

  const postList: RawPost[] = [];
  const seenShortcode = new Set<string>();
  let maxId: string | null = null;
  let hasMore = true;
  let pageIndex = 0;
  const maxPageCount = Math.ceil(maxPost / 12) + 1;

  while (hasMore && postList.length < maxPost && pageIndex < maxPageCount) {
    pageIndex++;

    const result: {
      status: number;
      itemList: unknown[];
      more: boolean;
      nextMaxId: string | null;
    } = await page.evaluate(
      async ({ userId, maxId, appId }) => {
        const url = `https://www.instagram.com/api/v1/feed/user/${userId}/?count=12`
          + (maxId ? `&max_id=${encodeURIComponent(maxId)}` : '');
        const response = await fetch(url, {
          headers: { 'X-IG-App-ID': appId },
          credentials: 'include',
        });
        if (!response.ok) {
          return {
            status: response.status,
            itemList: [] as unknown[],
            more: false,
            nextMaxId: null as string | null,
          };
        }
        // `items` / `more_available` / `next_max_id` are Instagram's wire
        // names. Read through an index signature so a foreign contract
        // does not have to satisfy this repo's naming rules.
        const data = await response.json() as Record<string, unknown>;
        const rawItem = data['items'];
        return {
          status: 200,
          itemList: Array.isArray(rawItem) ? rawItem : ([] as unknown[]),
          more: data['more_available'] === true,
          nextMaxId: (data['next_max_id'] as string | null) ?? null,
        };
      },
      { userId, maxId, appId: IG_APP_ID },
    );

    // 429 and 401 mean stop the whole run, not just this account.
    if (result.status === 429 || result.status === 401) {
      throw new InstagramBlockedError(result.status);
    }
    if (result.status !== 200) {
      console.warn(`  feed page ${pageIndex}: HTTP ${result.status}`);
      break;
    }

    let reachedOldPost = false;
    for (const item of result.itemList) {
      const post = parsePostNode(item as Record<string, unknown>);
      if (!post || seenShortcode.has(post.shortcode)) continue;

      // The feed is reverse-chronological, so the first old post means
      // everything after it is older still.
      if (post.postedAt && post.postedAt.getTime() < oldestAllowed) {
        reachedOldPost = true;
        break;
      }

      seenShortcode.add(post.shortcode);
      postList.push(post);
    }

    if (reachedOldPost) break;

    hasMore = result.more;
    maxId = result.nextMaxId;

    if (hasMore) await jitteredDelay(800);
  }

  return postList.slice(0, maxPost);
}
