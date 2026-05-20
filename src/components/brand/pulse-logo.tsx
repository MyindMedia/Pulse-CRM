import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Pulse brand logo. Renders the official PNG (gold pulse glyph +
 * "PULSE" wordmark) at a chosen size. Optional anchor to the dashboard. */
export function PulseLogo({
  size = "md",
  href = "/dashboard",
  className,
  asLink = true,
}: {
  size?: "sm" | "md" | "lg" | "xl";
  href?: string;
  className?: string;
  asLink?: boolean;
}) {
  const dims = {
    sm: "h-7",
    md: "h-9",
    lg: "h-12",
    xl: "h-16",
  }[size];

  const img = (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src="/pulse-logo.png"
      alt="Pulse"
      className={cn("w-auto select-none", dims, className)}
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
