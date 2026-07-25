import { useState } from 'react';
import { Calendar, Clock, ChevronDown } from 'lucide-react';

interface EventDatesDisplayProps {
  eventId: string;
  primaryDate: string | null;
  primaryEndDate?: string | null;
  primaryTime: string | null;
  primaryEndTime?: string | null;
  primaryVenue: string | null;
  isPublishedEvent?: boolean;
}

export function EventDatesDisplay({
  primaryDate,
  primaryEndDate,
  primaryTime,
  primaryEndTime,
}: EventDatesDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isMultiDay = primaryEndDate && primaryDate && primaryEndDate !== primaryDate;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-PH', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatDateRange = (first: string, last: string) => {
    const f = new Date(first);
    const l = new Date(last);
    const fMonth = f.toLocaleDateString('en-PH', { month: 'short' });
    const lMonth = l.toLocaleDateString('en-PH', { month: 'short' });

    if (fMonth === lMonth) {
      return `${fMonth} ${f.getDate()}–${l.getDate()}`;
    }
    return `${fMonth} ${f.getDate()} – ${lMonth} ${l.getDate()}`;
  };

  const formatTime = (timeStr?: string | null) => {
    if (!timeStr) return null;
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const formatTimeRange = (startTime: string | null, endTime?: string | null) => {
    const start = formatTime(startTime);
    if (!start) return null;
    const end = formatTime(endTime);
    if (!end) return start;
    return `${start} – ${end}`;
  };

  const calculateDaySpan = (startDate: string, endDate: string): number => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const msPerDay = 1000 * 60 * 60 * 24;
    return Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1;
  };

  const generateDateRange = (start: string, end: string): string[] => {
    const dates: string[] = [];
    const current = new Date(start);
    const endDate = new Date(end);
    while (current <= endDate) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };

  // Multi-day
  if (isMultiDay && primaryDate && primaryEndDate) {
    const daySpan = calculateDaySpan(primaryDate, primaryEndDate);
    const timeRangeStr = formatTimeRange(primaryTime, primaryEndTime);
    const displayDates = generateDateRange(primaryDate, primaryEndDate);

    return (
      <div className="space-y-1.5">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 text-[11px] w-full text-left hover:bg-muted/30 -mx-0.5 px-0.5 py-0.5 rounded transition-colors"
          style={{ transitionDuration: 'var(--duration-fast)' }}
        >
          <Calendar className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <span className="font-medium">{formatDateRange(primaryDate, primaryEndDate)}</span>
          <span className="text-[10px] text-muted-foreground bg-muted/50 px-1 py-0 rounded font-medium">
            {daySpan}d
          </span>
          {timeRangeStr && (
            <span className="flex items-center gap-0.5 text-muted-foreground">
              <Clock className="h-2.5 w-2.5" />
              {timeRangeStr}
            </span>
          )}
          <ChevronDown className={`h-3 w-3 text-muted-foreground/50 ml-auto transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </button>

        {isExpanded && (
          <div className="rounded-md border border-border/30 bg-muted/20 p-1.5 space-y-0.5">
            {displayDates.map((dateStr, index) => (
              <div
                key={`${dateStr}-${index}`}
                className="flex items-center justify-between text-[11px] px-1.5 py-0.5"
              >
                <span className="text-foreground">{formatDate(dateStr)}</span>
                {timeRangeStr && (
                  <span className="flex items-center gap-0.5 text-muted-foreground">
                    <Clock className="h-2.5 w-2.5" />
                    {timeRangeStr}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Single day
  const timeRangeStr = formatTimeRange(primaryTime, primaryEndTime);

  return (
    <div className="flex items-center gap-3 text-[11px]">
      {primaryDate && (
        <div className="flex items-center gap-1">
          <Calendar className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium">{formatDate(primaryDate)}</span>
        </div>
      )}
      {timeRangeStr && (
        <div className="flex items-center gap-1 text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>{timeRangeStr}</span>
        </div>
      )}
    </div>
  );
}
