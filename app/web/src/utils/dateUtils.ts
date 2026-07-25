import { format } from "date-fns";

/**
 * Format a date range smartly based on the dates
 * - Same day: "June 15"
 * - Same month: "June 15-17"
 * - Different months: "June 30 - July 2"
 * - Different years: "Dec 31, 2024 - Jan 2, 2025"
 */
export function formatDateRange(startDate: string | Date, endDate?: string | Date | null): string {
  if (!endDate) {
    return format(new Date(startDate), "MMM d");
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Check if same day
  if (format(start, "yyyy-MM-dd") === format(end, "yyyy-MM-dd")) {
    return format(start, "MMM d");
  }

  // Check if same month and year
  if (format(start, "yyyy-MM") === format(end, "yyyy-MM")) {
    return `${format(start, "MMM d")}-${format(end, "d")}`;
  }

  // Check if same year but different month
  if (format(start, "yyyy") === format(end, "yyyy")) {
    return `${format(start, "MMM d")} - ${format(end, "MMM d")}`;
  }

  // Different years
  return `${format(start, "MMM d, yyyy")} - ${format(end, "MMM d, yyyy")}`;
}

/**
 * Format a time range
 * - Single time: "7:00 PM"
 * - Time range: "7:00 PM - 10:00 PM"
 */
export function formatTimeRange(startTime: string | null, endTime?: string | null): string {
  // Parse time string (HH:MM:SS or HH:MM format)
  const parseTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
  };

  // If neither time exists, return TBA
  if (!startTime && !endTime) return "Time TBA";
  
  // If only end time exists
  if (!startTime && endTime) {
    return parseTime(endTime);
  }
  
  // If only start time exists
  if (startTime && !endTime) {
    return parseTime(startTime);
  }

  // Both times exist
  const formattedStart = parseTime(startTime!);
  const formattedEnd = parseTime(endTime!);
  
  // If times are the same, show only once
  if (endTime === startTime) {
    return formattedStart;
  }

  return `${formattedStart} - ${formattedEnd}`;
}

/**
 * Check if an array of dates are consecutive
 */
export function isConsecutiveDates(dates: Date[]): boolean {
  if (dates.length <= 1) return true;

  const sortedDates = [...dates].sort((a, b) => a.getTime() - b.getTime());
  
  for (let i = 1; i < sortedDates.length; i++) {
    const prevDate = sortedDates[i - 1];
    const currDate = sortedDates[i];
    const dayDiff = Math.floor((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (dayDiff !== 1) {
      return false;
    }
  }
  
  return true;
}

/**
 * Format multiple dates intelligently
 * - Consecutive: "June 15-17"
 * - Non-consecutive: "June 15, 17, 20"
 */
export function formatMultipleDates(dates: Date[]): string {
  if (dates.length === 0) return "";
  if (dates.length === 1) return format(dates[0], "MMM d");

  const sortedDates = [...dates].sort((a, b) => a.getTime() - b.getTime());

  if (isConsecutiveDates(sortedDates)) {
    return formatDateRange(sortedDates[0], sortedDates[sortedDates.length - 1]);
  }

  // Non-consecutive dates
  const firstDate = sortedDates[0];
  const month = format(firstDate, "MMM");
  const days = sortedDates.map(d => format(d, "d")).join(", ");
  
  return `${month} ${days}`;
}

/**
 * Generate an array of date strings for all dates between start and end (inclusive)
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 * @returns Array of date strings in YYYY-MM-DD format
 */
export function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  
  while (current <= end) {
    dates.push(format(current, 'yyyy-MM-dd'));
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}
