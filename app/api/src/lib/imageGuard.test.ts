import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  checkImageUrl,
  contentTypeForFile,
  isValidShortcode,
  resolveCacheDir,
  safeContentType,
} from './imageGuard.js';

describe('checkImageUrl — SSRF surface', () => {
  it('accepts a real Instagram CDN URL', () => {
    const result = checkImageUrl(
      'https://instagram.fmnl4-6.fna.fbcdn.net/v/t51.82787-15/656196844_18570139714036683.jpg?stp=dst-jpg',
    );
    expect(result.ok).toBe(true);
  });

  it('accepts scontent.cdninstagram.com', () => {
    expect(checkImageUrl('https://scontent.cdninstagram.com/v/abc.jpg').ok).toBe(true);
  });

  it('blocks cloud metadata', () => {
    // The canonical SSRF target — reachable from the VPS, returns credentials.
    const result = checkImageUrl('https://169.254.169.254/latest/meta-data/');
    expect(result.ok).toBe(false);
  });

  it('blocks private and loopback addresses', () => {
    for (const host of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '[::1]']) {
      expect(checkImageUrl(`https://${host}/x.jpg`).ok).toBe(false);
    }
  });

  it('blocks non-https schemes', () => {
    for (const url of [
      'file:///etc/passwd',
      'http://scontent.cdninstagram.com/x.jpg',
      'gopher://scontent.cdninstagram.com/',
      'data:image/png;base64,iVBORw0KGgo=',
    ]) {
      expect(checkImageUrl(url).ok).toBe(false);
    }
  });

  it('blocks arbitrary external hosts', () => {
    expect(checkImageUrl('https://evil.example.com/x.jpg').ok).toBe(false);
    expect(checkImageUrl('https://localhost/x.jpg').ok).toBe(false);
  });

  it('is not fooled by a lookalike suffix', () => {
    // Suffix matching is anchored on a dot, so this must not pass.
    expect(checkImageUrl('https://evil-fbcdn.net/x.jpg').ok).toBe(false);
    expect(checkImageUrl('https://fbcdn.net.evil.com/x.jpg').ok).toBe(false);
  });

  it('is not fooled by the allowlisted host appearing elsewhere in the URL', () => {
    expect(checkImageUrl('https://evil.com/?x=scontent.cdninstagram.com').ok).toBe(false);
    expect(checkImageUrl('https://evil.com/#.fbcdn.net').ok).toBe(false);
  });

  it('rejects embedded credentials used to confuse host parsing', () => {
    expect(checkImageUrl('https://scontent.cdninstagram.com@evil.com/x.jpg').ok).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(checkImageUrl('').ok).toBe(false);
    expect(checkImageUrl('not a url').ok).toBe(false);
  });

  it('matches the host case-insensitively', () => {
    expect(checkImageUrl('https://SCONTENT.CDNINSTAGRAM.COM/x.jpg').ok).toBe(true);
  });
});

describe('isValidShortcode — path traversal surface', () => {
  it('accepts real shortcodes', () => {
    for (const code of ['C1a2B3c4D5e', 'abc-DEF_123', 'A']) {
      expect(isValidShortcode(code)).toBe(true);
    }
  });

  it('rejects traversal and separators', () => {
    for (const code of [
      '../../../../root/.ssh',
      '..',
      'a/b',
      'a\\b',
      'a.b',
      '',
      'a'.repeat(65),
    ]) {
      expect(isValidShortcode(code)).toBe(false);
    }
  });

  it('rejects null bytes and encoded traversal', () => {
    expect(isValidShortcode('abc\0def')).toBe(false);
    expect(isValidShortcode('%2e%2e%2f')).toBe(false);
  });
});

describe('resolveCacheDir', () => {
  const root = resolve('/srv/ig-images');

  it('resolves a valid shortcode inside the root', () => {
    const dir = resolveCacheDir(root, 'C1a2B3c4D5e');
    expect(dir).toBe(resolve(root, 'C1a2B3c4D5e'));
  });

  it('refuses to escape the cache root', () => {
    expect(resolveCacheDir(root, '../../etc')).toBeNull();
    expect(resolveCacheDir(root, '..')).toBeNull();
  });

  it('returns null when no cache root is configured', () => {
    expect(resolveCacheDir('', 'C1a2B3c4D5e')).toBeNull();
  });
});

describe('safeContentType', () => {
  it('passes through allowed image types and strips parameters', () => {
    expect(safeContentType('image/jpeg')).toBe('image/jpeg');
    expect(safeContentType('image/webp; charset=binary')).toBe('image/webp');
    expect(safeContentType('IMAGE/PNG')).toBe('image/png');
  });

  it('rejects anything that would let the proxy serve markup or script', () => {
    // The proxy used to echo the upstream Content-Type verbatim.
    expect(safeContentType('text/html')).toBeNull();
    expect(safeContentType('application/javascript')).toBeNull();
    expect(safeContentType('image/svg+xml')).toBeNull(); // SVG can carry script
    expect(safeContentType(null)).toBeNull();
  });
});

describe('contentTypeForFile', () => {
  it('derives the type from the extension instead of hardcoding jpeg', () => {
    expect(contentTypeForFile('a.png')).toBe('image/png');
    expect(contentTypeForFile('a.webp')).toBe('image/webp');
    expect(contentTypeForFile('a.JPG')).toBe('image/jpeg');
  });
});
