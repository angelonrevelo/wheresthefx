import { Banknote, Gift, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/component/ui/tooltip';

interface PriceDisplayProps {
  isFree: boolean;
  price?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  priceNote?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'text-[11px]',
  md: 'text-xs',
  lg: 'text-sm font-semibold',
};

export function PriceDisplay({
  isFree,
  price,
  priceMin,
  priceMax,
  priceNote,
  size = 'md'
}: PriceDisplayProps) {

  if (isFree) {
    return (
      <div className={`flex items-center gap-1 text-success ${sizeClasses[size]}`}>
        <Gift className="h-3 w-3" />
        <span className="font-semibold">FREE</span>
      </div>
    );
  }

  if (priceMin != null && priceMax != null) {
    const hasTiers = priceMin !== priceMax;

    return (
      <div className={`flex items-center gap-1 text-muted-foreground ${sizeClasses[size]}`}>
        <Banknote className="h-3 w-3" />
        <span className="font-medium">
          {hasTiers ? (
            <>₱{priceMin.toLocaleString()} – ₱{priceMax.toLocaleString()}</>
          ) : (
            <>₱{priceMin.toLocaleString()}</>
          )}
        </span>

        {priceNote && (
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-xs whitespace-pre-wrap">{priceNote}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  }

  if (price != null) {
    return (
      <div className={`flex items-center gap-1 text-muted-foreground ${sizeClasses[size]}`}>
        <Banknote className="h-3 w-3" />
        <span className="font-medium">₱{price.toLocaleString()}</span>
      </div>
    );
  }

  return (
    <span className="text-muted-foreground/60 italic text-[11px]">Price TBA</span>
  );
}
