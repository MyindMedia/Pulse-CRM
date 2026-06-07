import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Pulse brand logo. Two variants:
 *  - "main" (default): the clean gold pulse glyph + "PULSE" wordmark. Used in
 *    the site header and app (no "by Myind Sound" subtext).
 *  - "footer": the lockup that includes "by Myind Sound". Reserved for footers.
 *
 * Both PNGs are width-cropped, so sizes fix the width and let height adapt. */
export function PulseLogo({
  size = "md",
  href = "/dashboard",
  className,
  asLink = true,
  variant = "main",
}: {
  size?: "sm" | "md" | "lg" | "xl" | "full";
  href?: string;
  className?: string;
  asLink?: boolean;
  variant?: "main" | "footer";
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

  const src = variant === "footer" ? "/pulse-logo.png" : "/pulse-logo-main.png";

  const img = (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
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
