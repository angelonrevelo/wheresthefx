import { useQuery } from "@tanstack/react-query";
import { groupEventsByProximity, type LocationMarker } from "@/util/cluster";

interface UseEventMarkersOption {
  /** Manila `YYYY-MM-DD` bounds. Strings, not Date, so the browser's
   *  timezone cannot shift the boundary away from the API's. */
  dateRange?: { start: string; end: string };
  priceFilter?: 'free' | 'paid' | 'all';
  searchQuery?: string;
  interestTags?: string[];
  category?: string;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function useEventMarkers(options: UseEventMarkersOption = {}) {
  return useQuery({
    queryKey: ['event-markers', options],
    queryFn: async (): Promise<LocationMarker[]> => {
      const params = new URLSearchParams();

      if (options.dateRange) {
        params.set('date_from', options.dateRange.start);
        params.set('date_to', options.dateRange.end);
      }

      if (options.category && options.category !== 'all') {
        params.set('category', options.category);
      }

      if (options.priceFilter === 'free') {
        params.set('free', 'true');
      } else if (options.priceFilter === 'paid') {
        params.set('free', 'false');
      }

      if (options.searchQuery) {
        params.set('search', options.searchQuery);
      }

      const query = params.toString();
      const url = `${API_BASE}/api/events/map${query ? '?' + query : ''}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const json = await res.json();

      const transformedData = (json.data || []).map((event: any) => ({
        id: event.eventId,
        post_id: null,
        source_post_id: null,
        post_url: event.source_post_url || null,
        caption: null,
        event_title: event.title,
        event_date: event.event_date,
        event_time: event.event_time,
        event_end_date: event.event_end_date || null,
        end_time: event.end_time || null,
        location_name: event.venue_name,
        location_address: event.venue_address || null,
        location_lat: event.venue_lat,
        location_lng: event.venue_lng,
        image_url: event.image_url,
        stored_image_url: null,
        is_free: event.is_free,
        price: event.price,
        price_min: event.price_min || null,
        price_max: event.price_max || null,
        price_note: event.price_note || null,
        signup_url: event.signup_url || null,
        event_status: event.event_status || 'confirmed',
        availability_status: event.availability_status || 'available',
        is_recurring: event.is_recurring || false,
        recurrence_pattern: event.recurrence_pattern || null,
        like_count: 0,
        comment_count: 0,
        category: event.category || 'other',
        instagram_account_username: event.source_username || null,
        instagram_accounts: event.source_username ? {
          username: event.source_username
        } : null
      }));

      return groupEventsByProximity(transformedData, 50);
    },
    staleTime: 5 * 60 * 1000,
  });
}
