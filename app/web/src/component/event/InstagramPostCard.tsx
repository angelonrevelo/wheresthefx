import { useState, useEffect } from "react";
import { MapPin, Heart, MessageCircle, ExternalLink, Bookmark, Flag, AtSign } from "lucide-react";
import { Card } from "@/component/ui/card";
import { Badge } from "@/component/ui/badge";
import { AspectRatio } from "@/component/ui/aspect-ratio";
import { isLoggedIn, toggleSaveEvent, getImageUrl } from "@/api/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ImageWithSkeleton } from "@/component/shared";

import { CATEGORY_LABELS, CATEGORY_COLORS } from "@/constant/categoryColors";
import { EventStatusBadge, EventStatus, AvailabilityBadge, AvailabilityStatus, PriceDisplay, RecurringEventBadge, EventDatesDisplay } from "@/component/badge";

export interface InstagramPost {
  id: string;
  post_id: string;
  caption: string | null;
  post_url: string;
  image_url: string | null;
  stored_image_url?: string | null;
  posted_at: string;
  like_count: number | null;
  comment_count: number | null;
  event_title: string | null;
  event_date: string | null;
  event_time: string | null;
  event_end_date: string | null;
  end_time: string | null;
  location_name: string | null;
  location_address: string | null;
  signup_url: string | null;
  is_event: boolean;
  distance?: number;
  location_lat?: number | null;
  location_lng?: number | null;
  published_event_id?: string | null;
  category?: string | null;
  event_status?: string | null;
  availability_status?: string | null;
  is_free?: boolean;
  price?: number | null;
  price_min?: number | null;
  price_max?: number | null;
  price_note?: string | null;
  is_recurring?: boolean | null;
  recurrence_pattern?: string | null;
  instagram_accounts: {
    username: string;
    display_name: string | null;
    follower_count: number | null;
    is_verified: boolean;
  };
}

interface InstagramPostCardProps {
  post: InstagramPost;
  variant?: 'default' | 'popup';
  onReport?: (postId: string) => void;
  isSaved?: boolean;
}

export const InstagramPostCard = ({ post, variant = 'default', onReport, isSaved }: InstagramPostCardProps) => {
  const [savedEvents, setSavedEvents] = useState<Set<string>>(isSaved ? new Set([post.id]) : new Set());
  const queryClient = useQueryClient();
  const isCancelled = post.event_status === 'cancelled';

  useEffect(() => {
    if (isSaved !== undefined) return;
  }, [post.id, post.published_event_id, isSaved]);

  const handleSave = async (eventId: string) => {
    if (!isLoggedIn()) {
      toast.error("Please sign in to save event");
      return;
    }

    const eventNumericId = post.published_event_id
      ? parseInt(post.published_event_id, 10)
      : parseInt(eventId, 10);

    if (isNaN(eventNumericId)) {
      toast.error("Unable to save this event");
      return;
    }

    const isCurrentlySaved = savedEvents.has(eventId);

    if (isCurrentlySaved) {
      setSavedEvents(prev => {
        const newSet = new Set(prev);
        newSet.delete(eventId);
        return newSet;
      });
    } else {
      setSavedEvents(prev => new Set(prev).add(eventId));
    }

    try {
      await toggleSaveEvent(eventNumericId);
      queryClient.invalidateQueries({ queryKey: ['saved-event'] });
      queryClient.invalidateQueries({ queryKey: ['saved-event-count'] });
      toast.success(isCurrentlySaved ? "Event removed from saved" : "Event saved!");
    } catch {
      if (isCurrentlySaved) {
        setSavedEvents(prev => new Set(prev).add(eventId));
      } else {
        setSavedEvents(prev => {
          const newSet = new Set(prev);
          newSet.delete(eventId);
          return newSet;
        });
      }
      toast.error(isCurrentlySaved ? "Failed to remove event" : "Failed to save event");
    }
  };

  const formatEngagement = (count: number) => {
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return count.toString();
  };

  const formatDistance = (distanceKm: number | undefined): string | null => {
    if (distanceKm === undefined) return null;
    if (distanceKm < 1.0) return `${Math.round(distanceKm * 1000)}m`;
    return `${distanceKm.toFixed(1)} km`;
  };

  return (
    <Card
      className={`p-2.5 border-border/30 shadow-none hover:bg-muted/30 transition-colors cursor-pointer ${isCancelled ? 'opacity-50 grayscale' : ''}`}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 180px", transitionDuration: 'var(--duration-fast)' }}
    >
      {/* Top: Image + Meta */}
      <div className="flex gap-2.5">
        {/* Thumbnail */}
        {(getImageUrl(post.stored_image_url, post.image_url, post.post_url)) && (
          variant === 'popup' ? (
            <div className="w-16 flex-shrink-0">
              <AspectRatio ratio={1 / 1}>
                <ImageWithSkeleton
                  src={getImageUrl(post.stored_image_url, post.image_url, post.post_url)}
                  alt={post.event_title || "Event"}
                  className="w-full h-full rounded-md object-cover bg-muted"
                />
              </AspectRatio>
            </div>
          ) : (
            <ImageWithSkeleton
              src={getImageUrl(post.stored_image_url, post.image_url, post.post_url)}
              alt={post.event_title || "Event"}
              className="w-16 h-16 rounded-md flex-shrink-0 bg-muted"
            />
          )
        )}

        {/* Title block */}
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-1">
            <AtSign className="h-3 w-3 text-accent flex-shrink-0" />
            <a
              href={`https://instagram.com/${post.instagram_accounts.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[11px] text-muted-foreground hover:underline truncate"
            >
              @{post.instagram_accounts.username}
            </a>
            {post.instagram_accounts.is_verified && (
              <Badge variant="secondary" className="text-[10px] px-1 py-0 leading-none h-3.5">
                ✓
              </Badge>
            )}
          </div>

          <h3 className={`font-semibold text-[13px] leading-snug line-clamp-2 ${isCancelled ? 'line-through' : ''}`}>
            {post.event_title || post.caption?.split('\n')[0] || 'Instagram Post'}
          </h3>

          {/* Status badges — only show non-default states */}
          {post.is_event && (post.event_status !== 'confirmed' || post.availability_status !== 'available' || post.is_recurring) && (
            <div className="flex flex-wrap gap-1">
              <EventStatusBadge status={post.event_status as EventStatus} size="sm" />
              <AvailabilityBadge status={post.availability_status as AvailabilityStatus} />
              <RecurringEventBadge isRecurring={post.is_recurring} pattern={post.recurrence_pattern} size="sm" />
            </div>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="mt-2 space-y-1">
        {/* Date & Time */}
        {post.is_event && post.event_date && (
          <EventDatesDisplay
            eventId={post.published_event_id || post.id}
            primaryDate={post.event_date}
            primaryEndDate={post.event_end_date}
            primaryTime={post.event_time}
            primaryEndTime={post.end_time}
            primaryVenue={post.location_name}
            isPublishedEvent={!!post.published_event_id}
          />
        )}

        {/* Location + Distance */}
        {post.is_event && post.location_name && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            <span className="truncate flex-1">{post.location_name}</span>
            {post.distance !== undefined && (
              <span className="text-accent text-[11px] font-medium whitespace-nowrap">
                {formatDistance(post.distance)}
              </span>
            )}
          </div>
        )}

        {/* Price */}
        {post.is_event && (
          <PriceDisplay
            isFree={post.is_free ?? false}
            price={post.price}
            priceMin={post.price_min}
            priceMax={post.price_max}
            priceNote={post.price_note}
            size="sm"
          />
        )}

        {/* Footer: engagement + actions */}
        <div className="flex items-center justify-between pt-0.5">
          <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
            {((post.like_count ?? 0) > 0 || (post.comment_count ?? 0) > 0) ? (
              <>
                <span className="flex items-center gap-0.5">
                  <Heart className="h-3 w-3" />
                  {formatEngagement(post.like_count ?? 0)}
                </span>
                <span className="flex items-center gap-0.5">
                  <MessageCircle className="h-3 w-3" />
                  {formatEngagement(post.comment_count ?? 0)}
                </span>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-0.5">
            {post.is_event && onReport && (
              <button
                className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors"
                onClick={() => onReport(post.id)}
                style={{ transitionDuration: 'var(--duration-fast)' }}
              >
                <Flag className="h-3 w-3" />
              </button>
            )}
            {post.is_event && (
              <button
                className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-accent transition-colors"
                onClick={() => handleSave(post.published_event_id || post.id)}
                style={{ transitionDuration: 'var(--duration-fast)' }}
              >
                <Bookmark
                  className={`h-3 w-3 ${
                    savedEvents.has(post.published_event_id || post.id) ? "fill-accent text-accent" : ""
                  }`}
                />
              </button>
            )}
            <button
              className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => window.open(post.post_url, '_blank', 'noopener,noreferrer')}
              style={{ transitionDuration: 'var(--duration-fast)' }}
            >
              <ExternalLink className="h-3 w-3" />
            </button>
            {post.is_event && post.category && CATEGORY_LABELS[post.category] && (
              <Badge
                className="text-[10px] px-1.5 py-0 leading-none rounded h-4 text-white border-0"
                style={{ backgroundColor: CATEGORY_COLORS[post.category] || '#9E9E9E' }}
              >
                {CATEGORY_LABELS[post.category]}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};
