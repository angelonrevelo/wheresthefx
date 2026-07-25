import { useState, useEffect } from "react";
import { Search, Calendar, User, Bookmark, Settings as SettingsIcon, DollarSign, LogOut, Bug, Info, Moon, Sun } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SavedEventsDrawer } from "@/components/events";
import { useNavigate } from "react-router-dom";
import { isLoggedIn, logout } from "@/api/client";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { resolveDateRange, type DatePreset } from "@/utils/dateRange";
import type { EventFilterPatch, PriceFilter } from "@/types/filter";

interface MapFiltersProps {
  onFilterChange: (patch: EventFilterPatch) => void;
  onSearchChange: (query: string) => void;
}

export function MapFilters({ onFilterChange, onSearchChange }: MapFiltersProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState<DatePreset>("all");
  const [selectedPrice, setSelectedPrice] = useState<PriceFilter>("all");
  const [savedDrawerOpen, setSavedDrawerOpen] = useState(false);
  const [isUserLoggedIn, setIsUserLoggedIn] = useState<boolean>(isLoggedIn());
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setIsUserLoggedIn(isLoggedIn());
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    onSearchChange(value);
  };

  const handleDateChange = (value: string) => {
    const preset = value as DatePreset;
    setSelectedDate(preset);
    onFilterChange({ dateRange: resolveDateRange(preset) });
  };

  const handlePriceChange = (value: string) => {
    const price = value as PriceFilter;
    setSelectedPrice(price);
    onFilterChange({ priceFilter: price });
  };

  const handleSignOut = async () => {
    logout();
    setIsUserLoggedIn(false);
    toast.success("Signed out successfully");
    navigate('/');
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-[var(--z-controls)]">
      <div className="flex items-center gap-1.5 px-3 py-2.5">
        {/* Search */}
        <div className="relative flex-1 min-w-0 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/50 pointer-events-none" />
          <input
            className="w-full h-8 glass-control rounded-lg pl-8 pr-3 text-xs text-white placeholder:text-white/40 focus:outline-none"
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            autoComplete="off"
          />
        </div>

        {/* Date Filter */}
        <Select value={selectedDate} onValueChange={handleDateChange}>
          <SelectTrigger className="md:w-[140px] w-8 h-8 glass-control bg-transparent text-white text-xs border-0 px-2 [&>svg.lucide-chevron-down]:hidden md:[&>svg.lucide-chevron-down]:block md:[&>svg.lucide-chevron-down]:h-3 md:[&>svg.lucide-chevron-down]:w-3 md:[&>svg.lucide-chevron-down]:opacity-40">
            <div className="flex items-center gap-1.5 w-full">
              <Calendar className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="hidden md:block truncate">
                <SelectValue placeholder="Date" />
              </span>
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Dates</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="weekend">This Weekend</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
          </SelectContent>
        </Select>

        {/* Price Filter */}
        <Select value={selectedPrice} onValueChange={handlePriceChange}>
          <SelectTrigger className="md:w-[120px] w-8 h-8 glass-control bg-transparent text-white text-xs border-0 px-2 [&>svg.lucide-chevron-down]:hidden md:[&>svg.lucide-chevron-down]:block md:[&>svg.lucide-chevron-down]:h-3 md:[&>svg.lucide-chevron-down]:w-3 md:[&>svg.lucide-chevron-down]:opacity-40">
            <div className="flex items-center gap-1.5 w-full">
              <DollarSign className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="hidden md:block truncate">
                <SelectValue placeholder="Price" />
              </span>
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Prices</SelectItem>
            <SelectItem value="free">Free Only</SelectItem>
            <SelectItem value="paid">Paid Events</SelectItem>
          </SelectContent>
        </Select>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User Menu */}
        {isUserLoggedIn ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-8 w-8 glass-control rounded-lg inline-flex items-center justify-center text-white/70 hover:text-white">
                <User className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                Signed In
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSavedDrawerOpen(true)}>
                <Bookmark className="h-3.5 w-3.5 mr-2" />
                Saved Events
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info("Coming soon!")}>
                <SettingsIcon className="h-3.5 w-3.5 mr-2" />
                Account Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                {theme === 'dark' ? (
                  <>
                    <Sun className="h-3.5 w-3.5 mr-2" />
                    Light Mode
                  </>
                ) : (
                  <>
                    <Moon className="h-3.5 w-3.5 mr-2" />
                    Dark Mode
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info("Use the feedback button to report bugs")}>
                <Bug className="h-3.5 w-3.5 mr-2" />
                Report a Bug
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info("Where's the f(x)? - Event Discovery App")}>
                <Info className="h-3.5 w-3.5 mr-2" />
                About
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                <LogOut className="h-3.5 w-3.5 mr-2" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            className="h-8 w-8 glass-control rounded-lg inline-flex items-center justify-center text-white/70 hover:text-white"
            onClick={() => navigate('/auth')}
          >
            <User className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <SavedEventsDrawer
        open={savedDrawerOpen}
        onClose={() => setSavedDrawerOpen(false)}
      />
    </div>
  );
}
