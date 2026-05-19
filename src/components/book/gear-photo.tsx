"use client";

import * as React from "react";
import { SlidersHorizontal, Mic, Boxes, Music, Speaker, Cable, Package } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Renders a category's fallback icon directly as JSX. Categories are open
 * strings on the backend, so matching is loose and always resolves.
 */
export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const c = category.toLowerCase();
  if (c.includes("console")) return <SlidersHorizontal className={className} strokeWidth={1.5} />;
  if (c.includes("mic")) return <Mic className={className} strokeWidth={1.5} />;
  if (c.includes("outboard")) return <Boxes className={className} strokeWidth={1.5} />;
  if (c.includes("instrument")) return <Music className={className} strokeWidth={1.5} />;
  if (c.includes("monitor")) return <Speaker className={className} strokeWidth={1.5} />;
  if (c.includes("rig")) return <Cable className={className} strokeWidth={1.5} />;
  return <Package className={className} strokeWidth={1.5} />;
}

/**
 * Gear thumbnail. `photo` may be null OR a URL that 404s — either way it falls
 * back to a tonal block with a category icon. A broken image is never shown.
 */
export function GearPhoto({
  photo,
  category,
  alt,
  className,
}: {
  photo: string | null;
  category: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const showFallback = !photo || failed;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border border-hairline bg-coal-2",
        className,
      )}
    >
      {showFallback ? (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_30%,var(--color-coal-3),var(--color-coal))]">
          <CategoryIcon category={category} className="size-7 text-ash-dim" />
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  );
}
