/**
 * WheresTheFX API Client
 *
 * Replaces the old Supabase client. Communicates with the Express
 * backend at /api/* endpoints. Handles JWT auth token management.
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/** Get stored JWT token */
function getToken(): string | null {
  return localStorage.getItem('wtfx_token');
}

/** Store JWT token */
export function setToken(token: string) {
  localStorage.setItem('wtfx_token', token);
}

/** Clear JWT token (logout) */
export function clearToken() {
  localStorage.removeItem('wtfx_token');
}

/** Check if user is logged in */
export function isLoggedIn(): boolean {
  return !!getToken();
}

/** Generic fetch wrapper with auth */
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `API error: ${res.status}`);
  }

  return res.json();
}

// ============================================================================
// AUTH
// ============================================================================

export interface AuthResponse {
  token: string;
  user: { id: number; email: string; username: string; display_name?: string };
}

export async function register(email: string, username: string, password: string) {
  const res = await apiFetch<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, username, password }),
  });
  setToken(res.token);
  return res;
}

export async function login(email: string, password: string) {
  const res = await apiFetch<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(res.token);
  return res;
}

export async function getMe() {
  return apiFetch<{ id: number; email: string; username: string; display_name?: string; preferences: string[] }>('/api/users/me');
}

export function logout() {
  clearToken();
}

// ============================================================================
// IMAGE PROXY
// ============================================================================

/**
 * Build the best available image URL for an event.
 * Priority: stored_image_url > proxy (CDN + blead cache fallback) > null
 */
export function getImageUrl(
  storedUrl: string | null | undefined,
  cdnUrl: string | null | undefined,
  postUrl?: string | null
): string | null {
  if (storedUrl) return storedUrl;
  if (!cdnUrl) return null;
  // Already a local/relative URL — use as-is
  if (cdnUrl.startsWith('/')) return cdnUrl;

  // Extract shortcode from post URL for blead cache fallback
  const shortcode = postUrl?.match(/\/p\/([^/?]+)/)?.[1] || '';
  const params = new URLSearchParams({ url: cdnUrl });
  if (shortcode) params.set('shortcode', shortcode);

  return `${API_BASE}/api/images/proxy?${params.toString()}`;
}

// ============================================================================
// EVENTS
// ============================================================================

export interface EventData {
  id: number;
  title: string;
  event_date: string;
  event_end_date?: string | null;
  event_time?: string | null;
  end_time?: string | null;
  description?: string | null;
  venue_name?: string | null;
  venue_address?: string | null;
  venue_lat?: number | null;
  venue_lng?: number | null;
  location_status?: string;
  is_free: boolean;
  price?: number | null;
  price_min?: number | null;
  price_max?: number | null;
  price_notes?: string | null;
  signup_url?: string | null;
  category: string;
  artists?: string[];
  event_status: string;
  availability_status?: string;
  image_url?: string | null;
  source_username?: string | null;
  event_hash?: string | null;
  is_saved?: boolean;
  // Source post info (for image proxy shortcode fallback)
  source_post_shortcode?: string | null;
  source_post_url?: string | null;
  venue?: any;
  sub_events?: any[];
  source_post?: any;
  source_account?: any;
}

export interface EventsResponse {
  data: EventData[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export async function fetchEvents(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return apiFetch<EventsResponse>(`/api/events${query ? '?' + query : ''}`);
}

export async function fetchUpcomingEvents(limit = 50) {
  return apiFetch<{ data: EventData[] }>(`/api/events/upcoming?limit=${limit}`);
}

export async function fetchMapEvents(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return apiFetch<{ data: any[] }>(`/api/events/map${query ? '?' + query : ''}`);
}

export async function fetchEvent(id: number) {
  return apiFetch<EventData>(`/api/events/${id}`);
}

// ============================================================================
// VENUES
// ============================================================================

export async function fetchVenues() {
  return apiFetch<{ data: any[] }>('/api/venues');
}

export async function fetchVenue(id: number) {
  return apiFetch<any>(`/api/venues/${id}`);
}

export async function fetchVenueEvents(venueId: number) {
  return apiFetch<{ data: EventData[] }>(`/api/venues/${venueId}/events`);
}

// ============================================================================
// CATEGORIES
// ============================================================================

export interface CategoryData {
  value: string;
  label: string;
  emoji: string;
  count: number;
}

export async function fetchCategories() {
  return apiFetch<{ data: CategoryData[] }>('/api/categories');
}

// ============================================================================
// USER
// ============================================================================

export async function toggleSaveEvent(eventId: number) {
  return apiFetch<{ saved: boolean }>('/api/users/me/saved', {
    method: 'POST',
    body: JSON.stringify({ event_id: eventId }),
  });
}

export async function fetchSavedEvents() {
  return apiFetch<{ data: EventData[] }>('/api/users/me/saved');
}

export async function updatePreferences(categories: string[]) {
  return apiFetch<{ categories: string[] }>('/api/users/me/preferences', {
    method: 'PUT',
    body: JSON.stringify({ categories }),
  });
}

// ============================================================================
// IMAGE PROXY
// ============================================================================

