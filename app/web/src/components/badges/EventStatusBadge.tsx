import { Badge } from '@/components/ui/badge';
import { AlertCircle, Calendar, Clock, HelpCircle, CheckCircle } from 'lucide-react';

export type EventStatus = 'confirmed' | 'rescheduled' | 'cancelled' | 'postponed' | 'tentative';

interface EventStatusBadgeProps {
  status: EventStatus | null | undefined;
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const statusConfig: Record<EventStatus, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  className: string;
}> = {
  confirmed: {
    label: 'Confirmed',
    icon: CheckCircle,
    className: 'bg-success/10 text-success border-success/20',
  },
  rescheduled: {
    label: 'Rescheduled',
    icon: Calendar,
    className: 'bg-warning/10 text-warning border-warning/20',
  },
  cancelled: {
    label: 'Cancelled',
    icon: AlertCircle,
    className: 'bg-destructive/10 text-destructive border-destructive/20 line-through',
  },
  postponed: {
    label: 'Postponed',
    icon: Clock,
    className: 'bg-warning/10 text-warning border-warning/20',
  },
  tentative: {
    label: 'Tentative',
    icon: HelpCircle,
    className: 'bg-muted text-muted-foreground border-border',
  },
};

const sizeClasses = {
  sm: 'text-[10px] px-1.5 py-0 h-4',
  md: 'text-xs px-2 py-0.5',
  lg: 'text-xs px-2.5 py-1',
};

export function EventStatusBadge({ status, showIcon = true, size = 'md' }: EventStatusBadgeProps) {
  const safeStatus = status ?? 'confirmed';
  if (safeStatus === 'confirmed') return null;

  const config = statusConfig[safeStatus as EventStatus];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={`${config.className} ${sizeClasses[size]} inline-flex items-center gap-0.5`}
    >
      {showIcon && <Icon className="h-2.5 w-2.5" />}
      {config.label}
    </Badge>
  );
}
