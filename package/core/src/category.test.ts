import { describe, expect, it } from 'vitest';
import { CATEGORY, CATEGORY_META, isCategory, normalizeCategory } from './category.js';

describe('CATEGORY', () => {
  it('holds exactly the canonical twelve', () => {
    expect(CATEGORY).toHaveLength(12);
  });

  it('has display metadata for every value', () => {
    for (const category of CATEGORY) {
      expect(CATEGORY_META[category]).toBeDefined();
      expect(CATEGORY_META[category].label).not.toBe('');
      expect(CATEGORY_META[category].emoji).not.toBe('');
    }
  });

  it('has no duplicates', () => {
    expect(new Set(CATEGORY).size).toBe(CATEGORY.length);
  });
});

describe('normalizeCategory', () => {
  it('passes canonical values through unchanged', () => {
    for (const category of CATEGORY) {
      expect(normalizeCategory(category)).toBe(category);
    }
  });

  it('preserves the five categories the old sync collapsed to `other`', () => {
    // blead's sync-to-postgres mapped each of these to 'other', so a fifth
    // of the taxonomy silently disappeared on every ingest run.
    for (const category of ['arts', 'film', 'sports', 'fitness', 'tech'] as const) {
      expect(normalizeCategory(category)).toBe(category);
    }
  });

  it('maps retired values onto live ones', () => {
    expect(normalizeCategory('art_culture')).toBe('arts');
    expect(normalizeCategory('gaming')).toBe('tech');
  });

  it('returns null for unknown values rather than guessing', () => {
    expect(normalizeCategory('karaoke')).toBeNull();
    expect(normalizeCategory('Music')).toBeNull(); // case-sensitive by design
    expect(normalizeCategory('')).toBeNull();
    expect(normalizeCategory(null)).toBeNull();
    expect(normalizeCategory(undefined)).toBeNull();
    expect(normalizeCategory(42)).toBeNull();
  });
});

describe('isCategory', () => {
  it('rejects legacy values — they are readable, not writable', () => {
    expect(isCategory('art_culture')).toBe(false);
    expect(isCategory('gaming')).toBe(false);
    expect(isCategory('other')).toBe(false);
  });

  it('accepts canonical values', () => {
    expect(isCategory('nightlife')).toBe(true);
    expect(isCategory('tech')).toBe(true);
  });
});
