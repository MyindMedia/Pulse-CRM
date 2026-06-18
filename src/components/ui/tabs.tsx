"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // max-w-full + horizontal scroll so long tab rows scroll on narrow
      // screens instead of clipping. Scrollbar hidden for a clean look.
      "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg material-ultrathin p-1 " +
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-steel " +
        "outline-none transition-[color,background-color,box-shadow,transform] duration-200 ease-out hover:text-bone " +
        "active:scale-[var(--press-scale)] focus-visible:ring-2 focus-visible:ring-gold/30 " +
        "data-[state=active]:bg-gold/15 data-[state=active]:text-gold-bright data-[state=active]:shadow-elev-1",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("outline-none focus-visible:ring-2 focus-visible:ring-gold/20", className)}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
