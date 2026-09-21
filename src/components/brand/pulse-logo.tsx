import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Pulse brand logo: the gold pulse glyph + "PULSE" wordmark, the one mark
 * used everywhere on the site and in the app. There used to be a second
 * "by ThaMyind" lockup for footers; it was retired 2026-09-20 so the brand
 * shows a single logo. The `variant` prop is kept so callers need not change
 * but no longer selects a different file.
 *
 * The image is width-cropped, so sizes fix the width and let height adapt. */
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

  void variant;
  const src = "/pulse-logo-main.webp";

  const img = (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt="Pulse"
      width={1000}
      height={297}
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
