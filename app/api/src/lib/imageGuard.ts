import { isIP } from 'node:net';
import { resolve, sep } from 'node:path';

/**
 * Guards for the public image proxy.
 *
 * The proxy took two pieces of raw user input and used both unchecked:
 *
 *   fetch(req.query.url)                       → full read-SSRF
 *   join(BLEAD_IMAGES_PATH, req.query.shortcode) → arbitrary file read
 *
 * Both were reachable with no authentication on a public host, and the
 * response body was returned to the caller. An attacker could read cloud
 * metadata, internal services on the VPS network, or any image on disk.
 */

/**
 * Hosts the proxy is allowed to fetch from.
 *
 * Instagram serves media from per-datacentre subdomains
 * (`instagram.fmnl4-6.fna.fbcdn.net`), so suffix matching is required —
 * but it is anchored on a dot so `evil-fbcdn.net` cannot match.
 */
const ALLOWED_HOST_SUFFIX = [
  '.cdninstagram.com',
  '.fbcdn.net',
] as const;

const ALLOWED_HOST_EXACT = [
  'cdninstagram.com',
  'fbcdn.net',
  'scontent.cdninstagram.com',
] as const;

export interface UrlRejection {
  ok: false;
  reason: string;
}

export interface UrlAcceptance {
  ok: true;
  url: URL;
}

/**
 * Validate a candidate CDN URL.
 *
 * Rejects anything that is not https, is not an allowlisted Instagram
 * host, or names an IP literal (which would bypass the host allowlist
 * entirely and is never how the CDN is addressed).
 */
export function checkImageUrl(raw: string): UrlAcceptance | UrlRejection {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'malformed url' };
  }

  // Blocks file:, data:, gopher:, and plain http downgrades.
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'only https is allowed' };
  }

  // Credentials in the URL are never legitimate here and can confuse
  // downstream parsers about which host is really being addressed.
  if (url.username || url.password) {
    return { ok: false, reason: 'credentials not allowed in url' };
  }

  const host = url.hostname.toLowerCase();

  // An IP literal cannot be an allowlisted host, and permitting one is
  // how link-local metadata endpoints get reached.
  if (isIP(host) !== 0 || host.startsWith('[')) {
    return { ok: false, reason: 'ip literals not allowed' };
  }

  const isAllowed =
    ALLOWED_HOST_EXACT.includes(host as (typeof ALLOWED_HOST_EXACT)[number]) ||
    ALLOWED_HOST_SUFFIX.some((suffix) => host.endsWith(suffix));

  if (!isAllowed) {
    return { ok: false, reason: 'host not allowed' };
  }

  return { ok: true, url };
}

/**
 * Instagram shortcodes are base64url-ish: letters, digits, `-` and `_`.
 *
 * Anything else — most importantly `.` and `/` — is rejected, which is
 * what stops `?shortcode=../../../../root/.ssh` from escaping the cache
 * directory.
 */
const SHORTCODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidShortcode(value: string): boolean {
  return SHORTCODE_PATTERN.test(value);
}

/**
 * Resolve a shortcode to its cache directory, or `null` if the result
 * would fall outside the cache root.
 *
 * The pattern check above is the primary defence; this is the belt-and-
 * braces check that survives someone loosening the pattern later.
 */
export function resolveCacheDir(cacheRoot: string, shortcode: string): string | null {
  if (!cacheRoot || !isValidShortcode(shortcode)) return null;

  const root = resolve(cacheRoot);
  const target = resolve(root, shortcode);

  if (target !== root && !target.startsWith(root + sep)) return null;

  return target;
}

/** Content types the proxy is willing to pass through. */
const ALLOWED_CONTENT_TYPE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

/**
 * Normalise an upstream Content-Type.
 *
 * The proxy previously echoed whatever the remote sent, which lets an
 * attacker-controlled response set e.g. `text/html` and turn an image
 * endpoint on our origin into an HTML-serving one.
 */
export function safeContentType(raw: string | null): string | null {
  if (!raw) return null;
  const base = raw.split(';')[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPE.includes(base as (typeof ALLOWED_CONTENT_TYPE)[number])
    ? base
    : null;
}

/** Content-Type inferred from a cached file's extension. */
export function contentTypeForFile(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return 'image/jpeg';
  }
}

/** Hard ceiling on a proxied response — an unbounded buffer is an OOM. */
export const MAX_IMAGE_BYTE = 8 * 1024 * 1024;
