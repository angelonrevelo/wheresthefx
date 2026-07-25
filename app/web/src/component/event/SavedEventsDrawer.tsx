import { useState } from "react";
import { Heart } from "lucide-react";
import { ScrollArea } from "@/component/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/component/ui/sheet";
import { useSavedEvents } from "@/hook/useSavedEvents";
import { InstagramPostCard, InstagramPost } from "./InstagramPostCard";
import { isLoggedIn } from "@/api/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/component/ui/alert-dialog";
import { toast } from "sonner";

interface SavedEventsDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function SavedEventsDrawer({ open, onClose }: SavedEventsDrawerProps) {
  const { data: savedEvents = [] } = useSavedEvents();
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportingPostId, setReportingPostId] = useState<string | null>(null);

  const handleReport = (postId: string) => {
    setReportingPostId(postId);
    setReportDialogOpen(true);
  };

  const handleConfirmReport = async () => {
    if (!reportingPostId) return;

    if (!isLoggedIn()) {
      toast.error("Please sign in to report event");
      setReportDialogOpen(false);
      setReportingPostId(null);
      return;
    }

    toast.success("Event reported successfully");
    setReportDialogOpen(false);
    setReportingPostId(null);
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-sm glass-card border-l-0 sm:mr-[var(--card-margin)] sm:mt-[var(--card-margin)] sm:mb-[var(--card-margin)] sm:rounded-[var(--card-radius)] sm:h-[calc(100vh-var(--card-margin)*2)]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-sm">
            <Heart className="h-4 w-4 fill-accent text-accent" />
            Saved Events ({savedEvents.length})
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-80px)] mt-4">
          {savedEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-52 text-center">
              <Heart className="h-10 w-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">No saved event yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Save event to view them here
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 pr-3">
              {savedEvents.map((event: any) => {
                const postData: InstagramPost = {
                  id: String(event.eventId),
                  post_id: String(event.eventId),
                  caption: event.description || null,
                  post_url: event.source_post?.post_url || '',
                  image_url: event.image_url || null,
                  stored_image_url: null,
                  posted_at: event.created_at || '',
                  like_count: 0,
                  comment_count: 0,
                  event_title: event.title || null,
                  event_date: event.event_date || null,
                  event_time: event.event_time || null,
                  event_end_date: event.event_end_date || null,
                  end_time: event.end_time || null,
                  location_name: event.venue_name || null,
                  location_address: event.venue_address || null,
                  location_lat: event.venue_lat || null,
                  location_lng: event.venue_lng || null,
                  signup_url: event.signup_url || null,
                  is_event: true,
                  published_event_id: String(event.eventId),
                  category: event.category || null,
                  is_free: event.is_free,
                  price: event.price || null,
                  price_min: event.price_min || null,
                  price_max: event.price_max || null,
                  price_note: event.price_note || null,
                  event_status: event.event_status || null,
                  availability_status: event.availability_status || null,
                  instagram_accounts: {
                    username: event.source_username || event.source_account?.username || 'unknown',
                    display_name: event.source_account?.display_name || null,
                    follower_count: event.source_account?.follower_count || null,
                    is_verified: event.source_account?.is_verified || false,
                  },
                };

                return <InstagramPostCard key={event.eventId} post={postData} onReport={handleReport} isSaved={true} />;
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>

      <AlertDialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Report Event</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to report this event? This action will notify moderators.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmReport} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              Report
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
