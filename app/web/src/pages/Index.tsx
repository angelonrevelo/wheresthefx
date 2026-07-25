import { useState, useEffect, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { MathVerification } from "@/components/auth";
import { Button } from "@/components/ui/button";
import { UserCircle } from "lucide-react";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { isLoggedIn } from "@/api/client";
import type { EventFilter, EventFilterPatch } from "@/types/filter";

// Lazy-load heavy map components — only downloaded after age verification
const EventMap = lazy(() => import("@/components/map/EventMap").then(m => ({ default: m.EventMap })));
const MapFilters = lazy(() => import("@/components/map/MapFilters").then(m => ({ default: m.MapFilters })));
const CategoryFilter = lazy(() => import("@/components/map/CategoryFilter").then(m => ({ default: m.CategoryFilter })));
const EventSidebar = lazy(() => import("@/components/events/EventSidebar").then(m => ({ default: m.EventSidebar })));
const UserOnboarding = lazy(() => import("@/components/auth/UserOnboarding").then(m => ({ default: m.UserOnboarding })));

const Index = () => {
  const navigate = useNavigate();
  const [isVerified, setIsVerified] = useState(false);
  const [isMapUnlocked, setIsMapUnlocked] = useState(false);
  const [filter, setFilter] = useState<EventFilter>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { hasCompletedOnboarding } = useUserPreferences();

  useEffect(() => {
    const hasVerified = sessionStorage.getItem('age_verified') === 'true';
    if (hasVerified) {
      setIsVerified(true);
      setIsMapUnlocked(true);
    }

    const authenticated = isLoggedIn();
    setIsAuthenticated(authenticated);

    if (authenticated) {
      sessionStorage.setItem('age_verified', 'true');
      setIsVerified(true);
      setIsMapUnlocked(true);
    }
  }, []);

  useEffect(() => {
    if (isMapUnlocked && isAuthenticated && hasCompletedOnboarding === false) {
      setShowOnboarding(true);
    }
  }, [isMapUnlocked, isAuthenticated, hasCompletedOnboarding]);

  const handleVerified = () => {
    sessionStorage.setItem('age_verified', 'true');
    setIsVerified(true);
    setTimeout(() => {
      setIsMapUnlocked(true);
    }, 1000);
  };

  /**
   * Merge rather than replace. MapFilters previously handed up a fresh
   * object, so picking a date silently wiped the user's interest tags.
   */
  const handleFilterChange = (patch: EventFilterPatch) => {
    setFilter((prev) => ({ ...prev, ...patch }));
  };

  const handleOnboardingComplete = (selectedTags: string[]) => {
    setShowOnboarding(false);
    setFilter((prev) => ({ ...prev, interestTags: selectedTags }));
  };

  return (
    <div className={`min-h-screen transition-colors duration-1000 ${isMapUnlocked ? 'bg-black' : 'bg-background'}`}>
      {/* Verification overlay */}
      <div
        className={`fixed inset-0 z-50 bg-white transition-opacity duration-1000 flex ${
          isVerified ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <div className="flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden">
          <div className="absolute bottom-0 right-0 pointer-events-none select-none translate-x-1/4 translate-y-1/4 z-0">
            <span className="math-function text-[40rem] text-muted-foreground/20 leading-none">
              f(x)
            </span>
          </div>

          <header className="absolute top-6 right-6">
            <Button
              className="glass-accent"
              size="sm"
              onClick={() => navigate("/auth")}
            >
              <UserCircle className="h-4 w-4 mr-2" />
              {isAuthenticated ? 'Account' : 'Sign In'}
            </Button>
          </header>

          <div className="max-w-3xl w-full space-y-12 z-10">
            <div className="space-y-2">
              <h1 className="text-5xl md:text-7xl font-light tracking-tight">
                Where's the{" "}
                <span className="math-function text-accent">f</span>
                <span className="math-function text-accent">(x)</span>
                <span className="text-muted-foreground">?</span>
              </h1>
              <p className="text-muted-foreground text-lg">
                Discover parties, thrift markets, and events in Quezon City
              </p>
            </div>

            <MathVerification onVerified={handleVerified} />
          </div>

          <footer className="absolute bottom-6 text-xs text-muted-foreground">
            Currently serving Quezon City · More cities coming soon
          </footer>
        </div>

        {/* Sidebar preview — desktop only, lazy */}
        <div className="hidden lg:block">
          <Suspense fallback={null}>
            <EventSidebar />
          </Suspense>
        </div>
      </div>

      {/* Map — only mounted after verification, so Leaflet + tiles don't load until needed */}
      {isMapUnlocked && (
        <Suspense fallback={<div className="fixed inset-0 bg-[#1a1a1f]" />}>
          <div className={`h-screen transition-opacity duration-1000 ${isMapUnlocked ? 'opacity-100' : 'opacity-0'}`}>
            <MapFilters onFilterChange={handleFilterChange} onSearchChange={setSearchQuery} />
            <div className="fixed top-[42px] left-0 right-0 lg:right-[calc(theme(width.72)+var(--card-margin))] z-[var(--z-controls)]">
              <CategoryFilter
                activeCategory={selectedCategory}
                onCategoryChange={(cat) => {
                  setSelectedCategory(cat);
                  setFilter((prev) => ({ ...prev, category: cat }));
                }}
              />
            </div>
            <EventMap filter={{ ...filter, category: selectedCategory }} searchQuery={searchQuery} />
            <UserOnboarding open={showOnboarding} onComplete={handleOnboardingComplete} />
          </div>
        </Suspense>
      )}
    </div>
  );
};

export default Index;
