import { useState, useEffect, useRef, useMemo } from "react";
import { InstagramPostCard, InstagramPost } from "./InstagramPostCard";
import { MapPin, Search } from "lucide-react";
import { Button } from "@/component/ui/button";
import { Input } from "@/component/ui/input";
import { fetchEvents, EventData } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { toast as sonnerToast } from "sonner";

const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

interface InstagramPostWithDistance extends InstagramPost {
  distance?: number;
}

const toInstagramPost = (e: EventData): InstagramPost => ({
  id: String(e.id),
  post_id: `event-${e.id}`,
  caption: e.description || null,
  post_url: e.source_post_url || e.source_post?.post_url || e.signup_url || null,
  image_url: e.image_url || null,
  stored_image_url: null,
  posted_at: e.event_date,
  like_count: null,
  comment_count: null,
  event_title: e.title,
  event_date: e.event_date,
  event_time: e.event_time || null,
  event_end_date: e.event_end_date || null,
  end_time: e.end_time || null,
  location_name: e.venue_name || null,
  location_address: e.venue_address || null,
  location_lat: e.venue_lat || null,
  location_lng: e.venue_lng || null,
  signup_url: e.signup_url || null,
  is_event: true,
  category: e.category,
  is_free: e.is_free,
  price: e.price || null,
  price_min: e.price_min || null,
  price_max: e.price_max || null,
  price_note: e.price_note || null,
  event_status: e.event_status,
  availability_status: e.availability_status || null,
  instagram_accounts: {
    username: e.source_username || "unknown",
    display_name: e.source_username || null,
    follower_count: null,
    is_verified: false,
  },
});

export const EventSidebar = () => {
  const [locationGranted, setLocationGranted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [displayLimit, setDisplayLimit] = useState(20);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Use React Query instead of raw useEffect fetch
  const { data: allPosts = [], isLoading: isLoadingPosts } = useQuery({
    queryKey: ['sidebar-event'],
    queryFn: async () => {
      const res = await fetchEvents({ is_event: "true" });
      return (res.data || []).map(toInstagramPost);
    },
    staleTime: 5 * 60 * 1000,
  });

  // Filter + sort client-side (memoized)
  const filteredPosts = useMemo(() => {
    let filtered: InstagramPostWithDistance[] = allPosts;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (post) =>
          post.caption?.toLowerCase().includes(q) ||
          post.event_title?.toLowerCase().includes(q)
      );
    }

    if (userLocation) {
      filtered = filtered
        .map((post) => {
          if (!post.location_lat || !post.location_lng) return null;
          const distance = calculateDistance(
            userLocation.lat, userLocation.lng,
            Number(post.location_lat), Number(post.location_lng)
          );
          return { ...post, distance };
        })
        .filter((post): post is InstagramPostWithDistance & { distance: number } => post !== null)
        .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    } else {
      filtered = filtered.filter((post) => post.location_lat && post.location_lng);
    }

    return filtered;
  }, [searchQuery, allPosts, userLocation]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    const loadMoreElement = loadMoreRef.current;
    if (!loadMoreElement || isLoadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && filteredPosts.length > displayLimit) {
            setIsLoadingMore(true);
            setTimeout(() => {
              setDisplayLimit((prev) => Math.min(prev + 20, filteredPosts.length));
              setIsLoadingMore(false);
            }, 100);
          }
        });
      },
      { rootMargin: "200px", threshold: 0.1 }
    );
    observer.observe(loadMoreElement);
    return () => observer.disconnect();
  }, [displayLimit, filteredPosts.length, isLoadingMore]);

  const requestLocation = () => {
    setIsLoading(true);
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
          setUserLocation(coords);
          setLocationGranted(true);
          setIsLoading(false);
          setLastUpdate(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
          sonnerToast.success("Location enabled - showing event near you");
        },
        () => {
          setIsLoading(false);
          sonnerToast.error("Location access denied - showing all QC event");
          setLocationGranted(true);
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
      );
    } else {
      setIsLoading(false);
      sonnerToast.error("Geolocation not supported");
      setLocationGranted(true);
    }
  };

  return (
    <aside className="fixed top-[var(--card-margin)] right-[var(--card-margin)] bottom-[var(--card-margin)] w-72 z-[var(--z-sidebar)] glass-card flex flex-col overflow-hidden" style={{ maxHeight: 'calc(100vh - var(--card-margin) * 2)' }}>
      {/* Header */}
      <div className="px-3.5 py-3 space-y-2.5 shrink-0 border-b border-border/30">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Functions Near You
          </h2>
          {!locationGranted && (
            <Button variant="ghost" size="sm" onClick={requestLocation} disabled={isLoading} className="text-[11px] h-6 px-2">
              <MapPin className="h-3 w-3 mr-1" />
              Enable
            </Button>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {locationGranted
            ? userLocation
              ? `Metro Manila \u00b7 By distance${lastUpdate ? ` \u00b7 ${lastUpdate}` : ""}`
              : "Metro Manila \u00b7 Location denied"
            : "Enable location to see events near you"}
        </p>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search event..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {!locationGranted ? (
          <div className="text-center py-10 space-y-3">
            <MapPin className="h-10 w-10 mx-auto text-muted-foreground/20" />
            <p className="text-xs text-muted-foreground">
              Enable location to discover functions near you
            </p>
            <Button size="sm" onClick={requestLocation} disabled={isLoading}>
              {isLoading ? "Requesting..." : "Enable Location"}
            </Button>
          </div>
        ) : isLoadingPosts ? (
          <div className="text-center py-8 text-xs text-muted-foreground">Loading event...</div>
        ) : (
          <>
            {filteredPosts.slice(0, displayLimit).map((post) => (
              <InstagramPostCard key={post.id} post={post} />
            ))}

            {filteredPosts.length > displayLimit && (
              <div ref={loadMoreRef} className="py-3">
                <div className="text-center text-[11px] text-muted-foreground">
                  {isLoadingMore ? "Loading more..." : "Scroll for more"}
                </div>
              </div>
            )}

            {filteredPosts.length === 0 && (
              <div className="text-center py-8 text-xs text-muted-foreground">No event found</div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};
