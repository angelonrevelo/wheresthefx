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

  // A leading @ is the author saying so outright. "@hungry_neighborsph"
  // reached production and geocoded to a guess, which is worse than no
  // pin at all.
  if (trimmed.startsWith('@')) return true;

  if (!HANDLE_SHAPED.test(trimmed)) return false;
  // The posting account's own handle is the common case, but any
  // unspaced all-lowercase token is more likely a handle than a venue.
  if (username && trimmed === username.toLowerCase().replace(/^@/, '')) return true;
  return /[._]/.test(trimmed) || trimmed.length > 12;
}

/**
 * Words that name a space, never a place you navigate to.
 *
 * The prompt already forbids these by name and the current model obeys —
 * every one of these in production came from the legacy extractions, not
 * from a fresh scrape. The list exists anyway because the handle rule
 * taught the same lesson twice: a prompt is a request, and one that slips
 * through puts fourteen events on a row called "Activity Center".
 *
 * Only strings that are *entirely* one of these are dropped. "S Maison
 * Atrium" and "The Dome, First United Building" name their building and
 * are kept; a bare "Atrium" does not.
 *
 * Deliberately excluded: "Dome", "Sala", "Backroom", "Reserve". Each is
 * generic in context and each is also plausibly somebody's bar, and a
 * hardcoded list is the wrong place to gamble on that.
 */
const GENERIC_SPACE = new Set([
  'activity center', 'activity centre', 'activity park', 'atrium', 'lobby', 'concourse',
  'open space', 'open field', 'open park', 'function room', 'main hall', 'ballroom',
  'covered court', 'covered courts',
  'multiple locations', 'various venues', 'various locations', 'the venue', 'venue tba',
  'tba', 'to be announced', 'the bar', 'the tent', 'exact location tba',
]);

/** A venue name no longer than this; past it, a caption leaked in. */
const MAX_VENUE_NAME_LENGTH = 80;

/** Caption scaffolding: "Where: Manila ... When: January 25 ... Time: 10:00 AM". */
const CAPTION_LABEL = /\b(when|where|time|venue|details)\s*:/i;

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    .replace(/['‘’ʼ`´]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A venue name that names no venue.
 *
 * Deliberately does NOT reject a venue that matches the event title.
 * That rule looked obvious and a dry run killed it: it took out "Vice
 * Comedy Club", "Legazpi Sunday Market", "Salcedo Market" and "House
 * Collab Underground", all real places whose events carry the venue's
 * name. An event named after where it happens is the normal case for a
 * comedy club, a weekend market or a bar residency, and far more common
 * than the model answering the venue question with the event.
 */
export function looksLikeNonVenue(venueName: string): boolean {
  const trimmed = venueName.trim();
  if (trimmed === '') return true;

  // An @mention anywhere in the name, not only as the whole of it.
  // "Cupid's Corner @thecornerhouseph" has spaces, so the handle rule
  // ignores it, and it reached the venue directory as a row of its own —
  // then survived a merge and displaced "The Corner House", the venue it
  // was pointing at all along.
  if (/(^|\s)@[a-z0-9._]{2,}/i.test(trimmed)) return true;

  // A caption fragment reached venueName intact once: "Where: Manila
  // (Exact location to be sent to confirmed participants) When: January
  // 25, 2026 Time: 10:00 AM to 1:00 PM".
  if (trimmed.length > MAX_VENUE_NAME_LENGTH) return true;
  if (CAPTION_LABEL.test(trimmed)) return true;
  if (EMOJI.test(trimmed)) return true;

  return GENERIC_SPACE.has(normalizeForCompare(trimmed));
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
        if (!name) return null;
        // Dropped rather than kept: neither a handle nor a bare room can
        // be geocoded, and each becomes a junk row in the venue directory
        // that then attracts more events.
        if (looksLikeHandle(name, username)) return null;
        if (looksLikeNonVenue(name)) return null;
        return name;
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
