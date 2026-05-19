import * as React from "react";
import { cn, initials, tintFromString } from "@/lib/utils";

const SIZES = {
  xs: "size-6 text-[0.625rem]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-lg",
} as const;

/** Initials avatar with a deterministic gold-band tint. */
export function Avatar({
  name,
  color,
  size = "md",
  className,
}: {
  name: string;
  color?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const tint = color ?? tintFromString(name);
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-md font-display font-semibold",
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: `${tint}22`, color: tint, boxShadow: `inset 0 0 0 1px ${tint}44` }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** Overlapping avatar stack for collaborator lists. */
export function AvatarStack({
  names,
  max = 4,
  size = "sm",
}: {
  names: string[];
  max?: number;
  size?: keyof typeof SIZES;
}) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((n, i) => (
        <Avatar key={i} name={n} size={size} className="ring-2 ring-ink" />
      ))}
      {extra > 0 && (
        <span
          className={cn(
            "inline-grid place-items-center rounded-md bg-coal-3 font-mono text-ash ring-2 ring-ink",
            SIZES[size],
          )}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}
