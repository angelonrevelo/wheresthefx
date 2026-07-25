import { useState } from "react";
import { X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { InstagramPostCard, InstagramPost } from "./InstagramPostCard";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isLoggedIn } from "@/api/client";
import { toast } from "sonner";

interface EventPopupProps {
  events: any[];
  onClose: () => void;
}

export function EventPopup({ events, onClose }: EventPopupProps) {
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportingPostId, setReportingPostId] = useState<string | null>(null);
  const [reportType, setReportType] = useState<string>("outdated");
  const [reportDescription, setReportDescription] = useState("");
  const handleReport = (postId: string) => {
    setReportingPostId(postId);
    setReportDialogOpen(true);
  };

  const handleConfirmReport = async () => {
    if (!reportingPostId) return;

    if (!isLoggedIn()) {
      toast.error("Please sign in to report events");
      return;
    }

    toast.success("Report submitted. Thank you!");
    setReportDialogOpen(false);
    setReportingPostId(null);
    setReportDescription("");
  };

  return (
    <>
    <div className="fixed inset-0 z-[var(--z-panel)] flex items-end md:items-center md:justify-center bg-black/50 backdrop-blur-sm">
      <Card className="relative w-[calc(100%-var(--card-margin)*2)] mx-[var(--card-margin)] mb-[var(--card-margin)] md:max-w-sm md:mx-auto md:mb-0 max-h-[60vh] md:max-h-[75vh] flex flex-col glass-card border-0 animate-slide-up overflow-hidden">
        {/* Drag handle — mobile */}
        <div className="md:hidden flex justify-center pt-2.5 pb-0.5 shrink-0" aria-hidden="true">
          <div className="w-8 h-0.5 rounded-full bg-current opacity-15" />
        </div>

        {/* Header */}
        <div className="px-3.5 py-3 border-b border-border/30 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold">
              {events[0]?.location_name || "Event Location"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {events.length} {events.length === 1 ? "event" : "events"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Events list */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-3 -webkit-overflow-scrolling-touch">
          <div className="space-y-2.5">
            {events.map((event) => {
              const postData: InstagramPost = {
                id: event.id,
                post_id: event.post_id || event.id,
                caption: event.caption || event.description,
                post_url: event.post_url || event.instagram_post_url,
                image_url: event.image_url,
                stored_image_url: event.stored_image_url,
                posted_at: event.created_at,
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
                published_event_id: event.id,
                category: event.category,
                is_free: event.is_free,
                price: event.price,
                price_min: event.price_min,
                price_max: event.price_max,
                price_notes: event.price_notes,
                event_status: event.event_status,
                availability_status: event.availability_status,
                is_recurring: event.is_recurring,
                recurrence_pattern: event.recurrence_pattern,
                instagram_accounts: {
                  username: event.instagram_account_username || event.instagram_accounts?.username || 'unknown',
                  display_name: null,
                  follower_count: null,
                  is_verified: false,
                },
              };

              return <InstagramPostCard key={event.id} post={postData} variant="popup" onReport={handleReport} />;
            })}
          </div>
        </div>
      </Card>

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
            <Button size="sm" onClick={handleConfirmReport}>Submit Report</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </>
  );
}
