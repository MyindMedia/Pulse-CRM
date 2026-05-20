"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* Pulse buttons - brutalist bones, depth ladder gives them weight.
   Primary glows warm gold; secondaries sit on a soft elevation and
   press into the surface on click. */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium " +
    "transition-[transform,box-shadow,background-color,border-color,color] duration-150 ease-out " +
    "outline-none disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none " +
    "focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2 " +
    "[&_svg]:size-4 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-gold text-gold-ink font-semibold shadow-gold-soft " +
          "hover:bg-gold-bright hover:shadow-gold-strong hover:-translate-y-px " +
          "active:translate-y-px active:shadow-elev-1",
        secondary:
          "bg-coal-2 text-bone border border-hairline-2 shadow-elev-1 " +
          "hover:bg-coal-3 hover:border-hairline-2 hover:shadow-elev-2 hover:-translate-y-px " +
          "active:translate-y-px active:shadow-elev-1",
        ghost:
          "text-ash " +
          "hover:bg-coal-2 hover:text-bone hover:shadow-elev-1 " +
          "active:translate-y-px active:shadow-none",
        outline:
          "border border-hairline-2 text-bone shadow-elev-1 " +
          "hover:bg-coal-2 hover:border-gold-dim hover:shadow-elev-2 hover:-translate-y-px " +
          "active:translate-y-px active:shadow-elev-1",
        danger:
          "bg-critical/15 text-critical border border-critical/30 shadow-elev-1 " +
          "hover:bg-critical/25 hover:shadow-elev-2 hover:-translate-y-px " +
          "active:translate-y-px active:shadow-elev-1",
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
