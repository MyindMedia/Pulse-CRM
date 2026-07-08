import * as React from "react";
import { cn } from "@/lib/utils";

/* Surface stack - Liquid Glass Studio. `material` picks the translucency
   tier: "thin" (default, glass) for elevated content blocks, "regular" for
   heavier panels, "solid" for dense/perf-sensitive grids. Interactive cards
   lift, warm their border, and grow their ambient shadow on hover. */
export function Card({
  className,
  interactive,
  elevation = 1,
  material = "thin",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
  elevation?: 0 | 1 | 2;
  material?: "solid" | "thin" | "regular";
}) {
  const surface =
    material === "solid"
      ? cn(
          "border border-hairline bg-coal",
          elevation === 0 ? "" : elevation === 2 ? "shadow-elev-2" : "shadow-elev-1",
        )
      : cn(
          // Glass tiers wear the razor gradient hairline: glass-edge draws the
          // visible 1px (specular white falling to a gold trace), while the
          // material's own border just reserves the pixel.
          material === "regular" ? "material-regular" : "material-thin",
          "glass-edge border-transparent",
        );
  return (
    <div
      className={cn(
        "rounded-chrome text-bone",
        surface,
        "transition-[transform,box-shadow,border-color,background-color] " +
          "[transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-smooth-out)]",
        interactive && "hover:-translate-y-0.5 hover:shadow-elev-3 cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("font-grotesk text-base font-semibold tracking-[-0.01em] text-bone", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-ash", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center gap-2 border-t border-hairline p-5", className)}
      {...props}
    />
  );
}
