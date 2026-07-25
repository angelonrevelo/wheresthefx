import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/component/ui/button";
import { isLoggedIn } from "@/api/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/component/ui/dialog";
import { Textarea } from "@/component/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/component/ui/select";
import { InstagramPostCard, InstagramPost } from "./InstagramPostCard";

interface EventSidePanelProps {
  event: any[];
  onClose: () => void;
}

export function EventSidePanel({ event, onClose }: EventSidePanelProps) {
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [, setReportingEventId] = useState<string | null>(null);
  const [reportType, setReportType] = useState<string>("outdated");
  const [reportDescription, setReportDescription] = useState("");

  const handleReport = async () => {
    if (!isLoggedIn()) {
      toast.error("Please sign in to report issues");
      return;
    }

    toast.success("Report submitted. Thank you!");
    setReportDialogOpen(false);
    setReportDescription("");
  };

  return (
    <>
      <div className="fixed top-[52px] right-[var(--card-margin)] bottom-[var(--card-margin)] w-[calc(100%-var(--card-margin)*2)] md:w-[380px] z-[var(--z-panel)] glass-card flex flex-col animate-slide-in-right overflow-hidden">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="px-3.5 py-3 border-b border-border/30 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">
                {event[0]?.location_name || "Event Location"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {event.length} {event.length === 1 ? "event" : "event"}
              </p>
            </div>
            <button
              onClick={onClose}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Event List */}
          <div className="flex-1 overflow-y-auto overscroll-contain p-3 -webkit-overflow-scrolling-touch">
            <div className="space-y-2.5">
              {event.map((event) => {
                const postData: InstagramPost = {
                  id: event.source_post_id || event.post_id,
                  post_id: event.post_id || event.eventId,
                  caption: event.caption,
                  post_url: event.post_url,
                  image_url: event.image_url,
                  stored_image_url: event.stored_image_url,
                  posted_at: event.posted_at,
                  like_count: event.like_count || 0,
                  comment_count: event.comment_count || 0,
                  event_title: event.event_title,
                  event_date: event.event_date,
                  event_time: event.event_time,
                  event_end_date: event.event_end_date,
                  end_time: event.end_time,
                  location_name: event.location_name,
                  location_address: event.location_address,
                  location_lat: event.location_lat,
                  location_lng: event.location_lng,
                  signup_url: event.signup_url,
                  is_event: true,
                  category: event.category,
                  is_free: event.is_free,
                  price: event.price,
                  price_min: event.price_min,
                  price_max: event.price_max,
                  price_note: event.price_note,
                  event_status: event.event_status,
                  availability_status: event.availability_status,
                  is_recurring: event.is_recurring,
                  recurrence_pattern: event.recurrence_pattern,
                  instagram_accounts: {
                    username: event.instagram_accounts?.username || 'unknown',
                    display_name: event.instagram_accounts?.display_name || null,
                    follower_count: event.instagram_accounts?.follower_count || null,
                    is_verified: event.instagram_accounts?.is_verified || false,
                  },
                };

                return (
                  <InstagramPostCard
                    key={event.eventId}
                    post={postData}
                    variant="popup"
                    onReport={(postId) => {
                      setReportingEventId(postId);
                      setReportDialogOpen(true);
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Report Dialog */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report Issue</DialogTitle>
            <DialogDescription>
              Help us improve by reporting issues with this event
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="outdated">Event already happened</SelectItem>
                <SelectItem value="wrong_location">Wrong location</SelectItem>
                <SelectItem value="wrong_date">Wrong date/time</SelectItem>
                <SelectItem value="spam">Spam/Not an event</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Additional details (optional)"
              value={reportDescription}
              onChange={(e) => setReportDescription(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReportDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleReport}>Submit Report</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
