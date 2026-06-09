import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[0.6875rem] font-medium " +
    "font-meta uppercase tracking-wide whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-graphite/60 bg-coal-2 text-steel",
        gold: "border-gold-dim/60 bg-gold/10 text-gold-bright",
        positive: "border-positive/30 bg-positive/10 text-positive",
        caution: "border-caution/30 bg-caution/10 text-caution",
        critical: "border-critical/30 bg-critical/10 text-critical",
        info: "border-info/30 bg-info/10 text-info",
        solid: "border-gold bg-gold text-gold-ink",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, tone, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export { badgeVariants };
