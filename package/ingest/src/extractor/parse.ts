import { normalizeCategory } from '@wheresthefx/core';
import type { LocationStatus } from '../prompt/extraction.js';
import {
  type AvailabilityStatus,
  type ExtractionResult,
  type SubEventDraft,
  type UrlType,
  emptyExtraction,
} from './type.js';

/**
 * Parse and sanity-check a model response.
 *
 * The model is instructed to return JSON, but "instructed to" is not
 * "guaranteed to" — it wraps output in code fences, hallucinates dates
 * years out, returns `0` for free events, and invents categories. Every
 * field here is coerced and bounded rather than trusted.
 */

/** Beyond this horizon a date is a hallucination, not a real listing. */
const MAX_MONTH_AHEAD = 18;

/** Nothing before this is a live event; the product launched after it. */
const MIN_EVENT_DATE = '2024-01-01';

/** Above this, a "price" is a phone number. */
const MAX_PLAUSIBLE_PRICE = 50_000;

const LOCATION_STATUS: readonly LocationStatus[] = ['confirmed', 'tba', 'secret', 'dm_for_details'];
const URL_TYPE: readonly UrlType[] = ['tickets', 'registration', 'rsvp', 'info', 'link_in_bio', 'dm'];
const AVAILABILITY_STATUS: readonly AvailabilityStatus[] = ['sold_out', 'waitlist', 'limited', 'early_bird'];

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An Instagram handle, not a venue.
 *
 * The prompt forbids taking a venue from an @mention, and mostly it
 * obeys — but "electricstudioph" still reached the venue directory from
 * a live run. Handles are lowercase, unspaced, and often the posting
 * account itself; a venue name a person would recognise is not.
 */
const HANDLE_SHAPED = /^[a-z0-9._]{3,30}$/;

export function looksLikeHandle(venueName: string, username?: string | null): boolean {
  const trimmed = venueName.trim();
  if (trimmed.includes(' ')) return false;
  if (!HANDLE_SHAPED.test(trimmed)) return false;
  // The posting account's own handle is the common case, but any
  // unspaced all-lowercase token is more likely a handle than a venue.
  if (username && trimmed === username.toLowerCase().replace(/^@/, '')) return true;
  return /[._]/.test(trimmed) || trimmed.length > 12;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Strip markdown fences the model adds despite being told not to. */
export function stripCodeFence(raw: string): string {
  return raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * A price, or null.
 *
 * Rejects negatives, zero (free is expressed by `isFree`, never `price:
 * 0`), phone numbers, and anything unparseable.
 */
export function asPrice(value: unknown): number | null {
  const parsed = asNumber(value);
  if (parsed === null) return null;
  if (parsed <= 0) return null;
  if (parsed > MAX_PLAUSIBLE_PRICE) return null;
  return parsed;
}

/**
 * A calendar date within the plausible window, or null.
 *
 * `postedAt` anchors the forward bound: a post from January that claims
 * an event three years out is hallucinating.
 */
export function asEventDate(value: unknown, postedAt: Date = new Date()): string | null {
  const raw = asString(value);
  if (!raw || !ISO_DATE_PATTERN.test(raw)) return null;

  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Round-trip rejects 2026-02-31 and friends.
  if (parsed.toISOString().slice(0, 10) !== raw) return null;

  if (raw < MIN_EVENT_DATE) return null;

  const horizon = new Date(postedAt);
  horizon.setMonth(horizon.getMonth() + MAX_MONTH_AHEAD);
  if (parsed.getTime() > horizon.getTime()) return null;

  return raw;
}

/** `HH:MM` in 24-hour form, or null. */
export function asTime(value: unknown): string | null {
  const raw = asString(value);
  return raw && TIME_PATTERN.test(raw) ? raw : null;
}

function asStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const list = value
    .map(entry => asString(entry))
    .filter((entry): entry is string => entry !== null);
  return list.length > 0 ? list : null;
}

function asSubEventList(value: unknown, postedAt: Date): SubEventDraft[] | null {
  if (!Array.isArray(value)) return null;

  const list: SubEventDraft[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const title = asString(record.title);
    if (!title) continue;
    list.push({
      title,
      date: asEventDate(record.date, postedAt),
      time: asTime(record.time),
      endTime: asTime(record.endTime),
      description: asString(record.description),
    });
  }

  return list.length > 0 ? list : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const raw = asString(value);
  return raw && allowed.includes(raw as T) ? (raw as T) : null;
}

export interface ParseOutcome {
  result: ExtractionResult;
  /** Category the model returned that the taxonomy does not recognise. */
  unknownCategory: string | null;
}

/**
 * Parse a raw model response into a validated result.
 *
 * Never throws: an unparseable response yields an empty, non-event result
 * so one malformed row cannot abort a batch.
 */
export function parseExtractionResponse(
  raw: string,
  postedAt: Date = new Date(),
  username?: string | null,
): ParseOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    return { result: emptyExtraction(), unknownCategory: null };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { result: emptyExtraction(), unknownCategory: null };
  }

  const record = parsed as Record<string, unknown>;

  const rawCategory = asString(record.category);
  const category = rawCategory ? normalizeCategory(rawCategory) : null;
  const unknownCategory = rawCategory && !category ? rawCategory : null;

  const price = asPrice(record.price);
  const priceMin = asPrice(record.priceMin);
  const priceMax = asPrice(record.priceMax);

  // A stated price contradicts isFree; the price wins, because "free
  // entrance, ₱500 consumable" is a paid event.
  const rawIsFree = typeof record.isFree === 'boolean' ? record.isFree : null;
  const isFree = price !== null && price > 0 ? false : rawIsFree;

  const confidence = asNumber(record.confidence);

  return {
    unknownCategory,
    result: {
      isEvent: asBool(record.isEvent, false),
      eventTitle: asString(record.eventTitle),
      eventDate: asEventDate(record.eventDate, postedAt),
      eventEndDate: asEventDate(record.eventEndDate, postedAt),
      allEventDateList: (() => {
        const list = asStringList(record.allEventDates);
        if (!list) return null;
        const valid = list
          .map(entry => asEventDate(entry, postedAt))
          .filter((entry): entry is string => entry !== null);
        return valid.length > 0 ? valid : null;
      })(),
      eventTime: asTime(record.eventTime),
      endTime: asTime(record.endTime),
      description: asString(record.description),
      artistList: asStringList(record.artists),
      venueName: (() => {
        const name = asString(record.venueName);
        // Dropped rather than kept: a handle cannot be geocoded and
        // becomes a junk row in the venue directory.
        return name && looksLikeHandle(name, username) ? null : name;
      })(),
      venueAddress: asString(record.venueAddress),
      locationStatus: oneOf(record.locationStatus, LOCATION_STATUS) ?? 'confirmed',
      price,
      priceMin,
      priceMax,
      priceNote: asString(record.priceNotes),
      isFree,
      signupUrl: asString(record.signupUrl),
      urlType: oneOf(record.urlType, URL_TYPE),
      category,
      availabilityStatus: oneOf(record.availabilityStatus, AVAILABILITY_STATUS),
      confidence: confidence === null ? 0 : Math.min(1, Math.max(0, confidence)),
      isRecurring: asBool(record.isRecurring, false),
      recurrencePattern: asString(record.recurrencePattern),
      isHistoricalPost: asBool(record.isHistoricalPost, false),
      reasoning: asString(record.reasoning),
      subEventList: asSubEventList(record.subEvents, postedAt),
      ocrText: asString(record.ocrText),
    },
  };
}
