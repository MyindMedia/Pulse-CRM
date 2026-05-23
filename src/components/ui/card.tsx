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
      : material === "regular"
        ? "material-regular"
        : "material-thin";
  return (
    <div
      className={cn(
        "rounded-xl text-bone",
        surface,
        interactive &&
          "transition-[transform,box-shadow,border-color,background-color] duration-200 ease-out " +
            "hover:border-hairline-2 hover:-translate-y-0.5 hover:shadow-elev-3 cursor-pointer",
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
      className={cn("font-display text-base font-semibold tracking-tight text-bone", className)}
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
