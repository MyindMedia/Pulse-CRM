"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* Pulse buttons - Liquid Glass Studio. Depth ladder gives weight, a gold
   sheen sweeps across on hover, and they spring-press into the surface on
   click. Primary glows warm gold; `glass` is a translucent toolbar variant;
   `brutal` keeps the original hard-edged stamp. */
const buttonVariants = cva(
  "sheen inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-chrome text-sm font-medium " +
    "transition-[transform,box-shadow,background-color,border-color,color] duration-200 ease-out " +
    "outline-none disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none " +
    "focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2 " +
    "[&_svg]:relative [&_svg]:z-[2] [&_svg]:size-4 [&_svg]:shrink-0 select-none " +
    "active:scale-[var(--press-scale)]",
  {
    variants: {
      variant: {
        primary:
          "bg-gold text-gold-ink font-semibold shadow-gold-soft " +
          "hover:bg-gold-bright hover:shadow-gold-strong hover:-translate-y-0.5",
        secondary:
          "material-ultrathin text-bone shadow-elev-1 " +
          "hover:bg-coal-3/70 hover:border-hairline-2 hover:shadow-elev-2 hover:-translate-y-0.5",
        ghost:
          "text-ash " +
          "hover:bg-coal-2/70 hover:text-bone hover:shadow-elev-1",
        outline:
          "border border-graphite/60 text-bone " +
          "hover:bg-coal-2/60 hover:border-gold hover:-translate-y-0.5",
        glass:
          "material-thin text-bone " +
          "hover:border-gold-dim/60 hover:-translate-y-0.5 hover:shadow-elev-3",
        danger:
          "bg-critical/15 text-critical border border-critical/30 shadow-elev-1 " +
          "hover:bg-critical/25 hover:shadow-elev-2 hover:-translate-y-0.5",
        brutal:
          "bg-bone text-ink font-semibold border-2 border-bone shadow-brutal " +
          "hover:-translate-x-px hover:-translate-y-px hover:shadow-[7px_7px_0_0_#000]",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "size-10",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
