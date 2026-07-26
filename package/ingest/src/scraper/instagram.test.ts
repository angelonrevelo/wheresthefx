import { describe, expect, it } from 'vitest';
import { parsePostNode } from './instagram.js';
import { parseProxyUrl } from './stealth.js';

/** A minimal but realistic v1 feed item. */
function node(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: 'C1a2B3c4D5e',
    media_type: 1,
    caption: { text: 'Jazz Night at Mow’s #jazz #manila @somedj' },
    taken_at: 1786000000,
    like_count: 42,
    comment_count: 7,
    image_versions2: { candidates: [{ url: 'https://cdn.example/a.jpg' }] },
    ...over,
  };
}

describe('parsePostNode', () => {
  it('parses a standard image post', () => {
    const post = parsePostNode(node());
    expect(post).not.toBeNull();
    expect(post!.shortcode).toBe('C1a2B3c4D5e');
    expect(post!.postUrl).toBe('https://www.instagram.com/p/C1a2B3c4D5e/');
    expect(post!.postType).toBe('image');
    expect(post!.likeCount).toBe(42);
    expect(post!.commentCount).toBe(7);
    expect(post!.imageUrlList).toEqual(['https://cdn.example/a.jpg']);
  });

  it('returns null without a shortcode', () => {
    expect(parsePostNode({ media_type: 1 })).toBeNull();
    expect(parsePostNode({ code: 123 })).toBeNull();
  });

  it('accepts the legacy `shortcode` key as well as `code`', () => {
    expect(parsePostNode({ shortcode: 'ABC' })?.shortcode).toBe('ABC');
  });

  it('distinguishes video from reel by product_type', () => {
    expect(parsePostNode(node({ media_type: 2 }))?.postType).toBe('video');
    expect(parsePostNode(node({ media_type: 2, product_type: 'clips' }))?.postType).toBe('reel');
  });

  it('collects every frame of a carousel', () => {
    const post = parsePostNode(node({
      media_type: 8,
      carousel_media: [
        { image_versions2: { candidates: [{ url: 'https://cdn.example/1.jpg' }] } },
        { image_versions2: { candidates: [{ url: 'https://cdn.example/2.jpg' }] } },
      ],
    }));
    expect(post!.postType).toBe('carousel');
    // The poster's key art is often not the first frame, so all are kept.
    expect(post!.imageUrlList).toContain('https://cdn.example/1.jpg');
    expect(post!.imageUrlList).toContain('https://cdn.example/2.jpg');
  });

  it('deduplicates repeated image urls', () => {
    const post = parsePostNode(node({ display_url: 'https://cdn.example/a.jpg' }));
    expect(post!.imageUrlList).toEqual(['https://cdn.example/a.jpg']);
  });

  it('reads taken_at as seconds or milliseconds', () => {
    const asSecond = parsePostNode(node({ taken_at: 1786000000 }))!.postedAt;
    const asMillisecond = parsePostNode(node({ taken_at: 1786000000000 }))!.postedAt;
    expect(asSecond?.getTime()).toBe(asMillisecond?.getTime());
  });

  it('tolerates a missing or malformed timestamp', () => {
    expect(parsePostNode(node({ taken_at: undefined }))!.postedAt).toBeNull();
    expect(parsePostNode(node({ taken_at: 'yesterday' }))!.postedAt).toBeNull();
  });

  it('extracts hashtags and mentions, including accented characters', () => {
    const post = parsePostNode(node({
      caption: { text: 'Fiesta! #niño #manila @venue.ph @dj_name' },
    }));
    expect(post!.hashtagList).toContain('#niño');
    expect(post!.hashtagList).toContain('#manila');
    expect(post!.mentionList).toEqual(['@venue.ph', '@dj_name']);
  });

  it('handles a post with no caption', () => {
    const post = parsePostNode(node({ caption: null }));
    expect(post!.caption).toBeNull();
    expect(post!.hashtagList).toEqual([]);
    expect(post!.mentionList).toEqual([]);
  });

  it('reads a tagged location when present', () => {
    expect(parsePostNode(node({ location: { name: "Mow's Bar" } }))!.taggedLocation)
      .toBe("Mow's Bar");
    expect(parsePostNode(node())!.taggedLocation).toBeNull();
  });

  it('defaults engagement counts to zero rather than undefined', () => {
    const post = parsePostNode(node({ like_count: undefined, comment_count: undefined }));
    expect(post!.likeCount).toBe(0);
    expect(post!.commentCount).toBe(0);
  });
});

describe('parseProxyUrl', () => {
  it('splits credentials out of the url, as Playwright requires', () => {
    expect(parseProxyUrl('http://user:pass@10.0.0.1:8080')).toEqual({
      server: 'http://10.0.0.1:8080',
      username: 'user',
      password: 'pass',
    });
  });

  it('handles a proxy without credentials', () => {
    expect(parseProxyUrl('http://10.0.0.1:8080')).toEqual({ server: 'http://10.0.0.1:8080' });
  });

  it('assumes http when no scheme is given', () => {
    expect(parseProxyUrl('10.0.0.1:8080')?.server).toBe('http://10.0.0.1:8080');
  });

  it('returns null for absent or unparseable input', () => {
    expect(parseProxyUrl(null)).toBeNull();
    expect(parseProxyUrl(undefined)).toBeNull();
    expect(parseProxyUrl('')).toBeNull();
  });

  it('decodes percent-encoded credentials', () => {
    expect(parseProxyUrl('http://user:p%40ss@10.0.0.1:8080')?.password).toBe('p@ss');
  });
});
