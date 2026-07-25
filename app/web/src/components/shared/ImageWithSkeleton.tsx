import { useState, useEffect, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ImageWithSkeletonProps {
  /** Nullable: getImageUrl returns null when a post has no usable image. */
  src: string | null;
  alt: string;
  className?: string;
  aspectRatio?: "square" | "video" | "custom";
  unloadThreshold?: number; // Distance in pixels to unload image
}

export const ImageWithSkeleton = ({ 
  src, 
  alt, 
  className,
  aspectRatio: _aspectRatio = "custom",
  unloadThreshold = 2000 // Unload images more than 2 screens away
}: ImageWithSkeletonProps) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Intersection Observer for loading images before they enter viewport
    const loadObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            setImageSrc(src);
          }
        });
      },
      {
        rootMargin: "400px", // Start loading 400px before entering viewport
        threshold: 0.01,
      }
    );

    // Intersection Observer for unloading images far from viewport (memory management)
    const unloadObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            // Unload image if it's far from viewport
            const rect = entry.boundingClientRect;
            const viewportHeight = window.innerHeight;
            const distanceFromViewport = Math.min(
              Math.abs(rect.bottom),
              Math.abs(rect.top - viewportHeight)
            );

            if (distanceFromViewport > unloadThreshold) {
              setImageSrc(null);
              setIsLoaded(false);
            }
          }
        });
      },
      {
        rootMargin: `${unloadThreshold}px`,
        threshold: 0,
      }
    );

    loadObserver.observe(container);
    unloadObserver.observe(container);

    return () => {
      loadObserver.disconnect();
      unloadObserver.disconnect();
    };
  }, [src, unloadThreshold]);

  return (
    <div 
      ref={containerRef}
      className={cn("relative overflow-hidden", className)}
      style={{ contentVisibility: "auto" }} // CSS optimization
    >
      {(!isLoaded || !imageSrc) && !hasError && (
        <Skeleton className="absolute inset-0" />
      )}
      {shouldLoad && imageSrc && (
        <img
          ref={imgRef}
          src={hasError ? "/placeholder.svg" : imageSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={cn(
            "transition-opacity duration-300 w-full h-full object-cover",
            isLoaded ? "opacity-100" : "opacity-0"
          )}
          onLoad={() => setIsLoaded(true)}
          onError={(e) => {
            setHasError(true);
            setIsLoaded(true);
            e.currentTarget.src = "/placeholder.svg";
          }}
        />
      )}
    </div>
  );
};
