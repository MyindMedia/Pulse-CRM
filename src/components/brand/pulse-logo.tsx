import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Pulse brand logo. Renders the official PNG (gold pulse glyph +
 * "PULSE" wordmark) at a chosen size.
 *
 * The source PNG is tightly cropped (~3.16:1 aspect), so sizes here
 * fix the width and let the height adapt naturally. */
export function PulseLogo({
  size = "md",
  href = "/dashboard",
  className,
  asLink = true,
}: {
  size?: "sm" | "md" | "lg" | "xl" | "full";
  href?: string;
  className?: string;
  asLink?: boolean;
}) {
  // Width-based sizing. `full` fills the parent so the sidebar can stretch
  // the lockup across the whole rail.
  const sizeCls = {
    sm: "w-24",
    md: "w-32",
    lg: "w-48",
    xl: "w-64",
    full: "w-full",
  }[size];

  const img = (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src="/pulse-logo.png"
      alt="Pulse"
      className={cn("h-auto select-none", sizeCls, className)}
      draggable={false}
    />
  );

  if (!asLink) return img;
  return (
    <Link href={href} className="inline-flex items-center" aria-label="Pulse home">
      {img}
    </Link>
  );
}
