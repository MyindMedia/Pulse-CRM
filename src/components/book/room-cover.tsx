"use client";

import * as React from "react";
import { Disc3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { tintFromString } from "@/lib/utils";

/**
 * Room cover image. Uses the first usable entry from the room's photo list;
 * if there are none, or every URL 404s, it renders a deterministic tonal
 * block keyed off the room name so the studio front still looks intentional.
 */
export function RoomCover({
  photos,
  name,
  className,
}: {
  photos: string[];
  name: string;
  className?: string;
}) {
  const [index, setIndex] = React.useState(0);
  const current = photos[index];
  const exhausted = index >= photos.length;
  const tint = tintFromString(name);

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-coal-2",
        className,
      )}
    >
      {!exhausted && current ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current}
            alt={name}
            loading="lazy"
            onError={() => setIndex((i) => i + 1)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-coal via-coal/20 to-transparent" />
        </>
      ) : (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{
            backgroundImage: `radial-gradient(circle at 30% 25%, ${tint}, transparent 70%), linear-gradient(135deg, var(--color-coal-2), var(--color-ink-2))`,
          }}
        >
          <Disc3 className="size-12 text-bone/10" strokeWidth={1} />
        </div>
      )}
    </div>
  );
}
