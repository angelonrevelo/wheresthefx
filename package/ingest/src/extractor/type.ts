import type { Category } from '@wheresthefx/core';
import type { LocationStatus } from '../prompt/extraction.js';

export type UrlType = 'tickets' | 'registration' | 'rsvp' | 'info' | 'link_in_bio' | 'dm';
export type AvailabilityStatus = 'sold_out' | 'waitlist' | 'limited' | 'early_bird';

export interface SubEventDraft {
  title: string;
  date: string | null;
  time: string | null;
  endTime: string | null;
  description: string | null;
}

/**
 * One extraction result.
 *
 * `category` is `Category | null` rather than `string`: an unrecognised
 * value is surfaced as null and counted, never silently coerced to
 * `other`. That coercion is how five of twelve categories previously
 * disappeared without anyone noticing.
 */
export interface ExtractionResult {
  isEvent: boolean;
  eventTitle: string | null;
  eventDate: string | null;
  eventEndDate: string | null;
  allEventDateList: string[] | null;
  eventTime: string | null;
  endTime: string | null;
  description: string | null;
  artistList: string[] | null;
  venueName: string | null;
  venueAddress: string | null;
  locationStatus: LocationStatus;
  price: number | null;
  priceMin: number | null;
  priceMax: number | null;
  priceNote: string | null;
  isFree: boolean | null;
  signupUrl: string | null;
  urlType: UrlType | null;
  category: Category | null;
  availabilityStatus: AvailabilityStatus | null;
  confidence: number;
  isRecurring: boolean;
  recurrencePattern: string | null;
  isHistoricalPost: boolean;
  reasoning: string | null;
  subEventList: SubEventDraft[] | null;
  ocrText: string | null;
}

/** Provenance, persisted alongside every extracted row. */
export interface ExtractionProvenance {
  /** `ai`, `ai+image`, `regex`, `merged`, or `none`. */
  method: string;
  /** Model id, e.g. `gemini-2.5-flash`. */
  model: string | null;
  /** `PROMPT_VERSION` at the time of extraction. */
  promptVersion: string | null;
  extractedAt: Date;
}

export interface ExtractionOutcome {
  result: ExtractionResult;
  provenance: ExtractionProvenance;
}

/** An empty result — used when a post is not an event, or parsing fails. */
export function emptyExtraction(): ExtractionResult {
  return {
    isEvent: false,
    eventTitle: null,
    eventDate: null,
    eventEndDate: null,
    allEventDateList: null,
    eventTime: null,
    endTime: null,
    description: null,
    artistList: null,
    venueName: null,
    venueAddress: null,
    locationStatus: 'confirmed',
    price: null,
    priceMin: null,
    priceMax: null,
    priceNote: null,
    isFree: null,
    signupUrl: null,
    urlType: null,
    category: null,
    availabilityStatus: null,
    confidence: 0,
    isRecurring: false,
    recurrencePattern: null,
    isHistoricalPost: false,
    reasoning: null,
    subEventList: null,
    ocrText: null,
  };
}
