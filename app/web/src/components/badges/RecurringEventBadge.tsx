import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface RecurringEventBadgeProps {
  isRecurring?: boolean | null;
  pattern?: string | null;
  size?: 'sm' | 'default';
}

const PATTERN_LABELS: Record<string, string> = {
  'weekly:monday': 'Every Monday',
  'weekly:tuesday': 'Every Tuesday',
  'weekly:wednesday': 'Every Wednesday',
  'weekly:thursday': 'Every Thursday',
  'weekly:friday': 'Every Friday',
  'weekly:saturday': 'Every Saturday',
  'weekly:sunday': 'Every Sunday',
  'monthly:first-saturday': '1st Saturday monthly',
  'monthly:last-friday': 'Last Friday monthly',
  'daily': 'Daily',
  'biweekly': 'Every 2 weeks',
};

function parsePattern(pattern: string | null | undefined): string {
  if (!pattern) return 'Recurring';

  if (PATTERN_LABELS[pattern.toLowerCase()]) {
    return PATTERN_LABELS[pattern.toLowerCase()];
  }

  const weeklyMatch = pattern.match(/^weekly:(\w+)$/i);
  if (weeklyMatch) {
    const day = weeklyMatch[1].charAt(0).toUpperCase() + weeklyMatch[1].slice(1).toLowerCase();
    return `Every ${day}`;
  }

  const monthlyMatch = pattern.match(/^monthly:(\w+)-(\w+)$/i);
  if (monthlyMatch) {
    const nth = monthlyMatch[1];
    const day = monthlyMatch[2].charAt(0).toUpperCase() + monthlyMatch[2].slice(1).toLowerCase();
    return `${nth} ${day} monthly`;
  }

  return pattern;
}

export function RecurringEventBadge({ isRecurring, pattern, size = 'default' }: RecurringEventBadgeProps) {
  if (!isRecurring) return null;

  const label = parsePattern(pattern);
  const isSmall = size === 'sm';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={`bg-accent/10 text-accent border-accent/20 inline-flex items-center gap-0.5 ${
              isSmall ? 'text-[10px] px-1.5 py-0 h-4' : 'text-xs px-2 py-0.5'
            }`}
          >
            <RefreshCw className={isSmall ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
            {isSmall ? 'Recurring' : label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
