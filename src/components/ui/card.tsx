import * as React from "react";
import { cn } from "@/lib/utils";

/* Surface stack - depth via elevation ladder, hierarchy via tone + hairline. */
export function Card({
  className,
  interactive,
  elevation = 1,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
  elevation?: 0 | 1 | 2;
}) {
  const elev =
    elevation === 0 ? "" : elevation === 2 ? "shadow-elev-2" : "shadow-elev-1";
  return (
    <div
      className={cn(
        "rounded-lg border border-hairline bg-coal text-bone",
        elev,
        interactive &&
          "transition-all duration-150 hover:border-hairline-2 hover:bg-coal-2 hover:shadow-elev-2 cursor-pointer",
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
