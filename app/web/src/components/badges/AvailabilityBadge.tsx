import { Badge } from '@/components/ui/badge';
import { Ticket, AlertTriangle, Clock, Users } from 'lucide-react';

export type AvailabilityStatus = 'available' | 'sold_out' | 'waitlist' | 'limited' | 'few_left';

interface AvailabilityBadgeProps {
  status: AvailabilityStatus | null | undefined;
  showIcon?: boolean;
}

const availabilityConfig: Record<AvailabilityStatus, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  className: string;
}> = {
  available: {
    label: 'Available',
    icon: Ticket,
    className: 'bg-success/10 text-success border-success/20',
  },
  sold_out: {
    label: 'SOLD OUT',
    icon: AlertTriangle,
    className: 'bg-destructive text-destructive-foreground border-destructive font-semibold',
  },
  waitlist: {
    label: 'Waitlist',
    icon: Clock,
    className: 'bg-accent/10 text-accent border-accent/20',
  },
  limited: {
    label: 'Limited',
    icon: Users,
    className: 'bg-warning/10 text-warning border-warning/20',
  },
  few_left: {
    label: 'Few Left',
    icon: AlertTriangle,
    className: 'bg-warning text-warning-foreground border-warning font-semibold',
  },
};

export function AvailabilityBadge({ status, showIcon = true }: AvailabilityBadgeProps) {
  const safeStatus = status ?? 'available';
  if (safeStatus === 'available') return null;

  const config = availabilityConfig[safeStatus as AvailabilityStatus];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={`${config.className} text-[10px] px-1.5 py-0 h-4 inline-flex items-center gap-0.5`}
    >
      {showIcon && <Icon className="h-2.5 w-2.5" />}
      {config.label}
    </Badge>
  );
}
