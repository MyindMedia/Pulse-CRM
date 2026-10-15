"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/* The detail surface for sessions, invoices, deals, bookings and the rest.
   Every one opens as a centered modal (Lawrence, 2026-10-14: "center modals,
   not side, for all"): wide, at most about 90% of the viewport tall, header
   and footer fixed, body scrolling. Under 640px it becomes a full-screen
   iOS-style sheet that rises from the bottom. Radix keeps the focus trap,
   Escape and overlay click to close.

   `placement="side"` keeps the old right-edge drawer. It is only for
   navigation (the phone nav menu), never for a record's detail. */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

const CENTER_WIDTH = { sm: "sm:max-w-lg", md: "sm:max-w-3xl", lg: "sm:max-w-4xl", xl: "sm:max-w-6xl" } as const;
const SIDE_WIDTH = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-2xl", xl: "max-w-3xl" } as const;

export function SheetContent({
  className,
  children,
  width = "md",
  placement = "center",
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  width?: "sm" | "md" | "lg" | "xl";
  placement?: "center" | "side";
}) {
  const side = placement === "side";
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="anim-overlay fixed inset-0 z-50 bg-ink/80 backdrop-blur-sm" />
      <DialogPrimitive.Content
        data-placement={placement}
        className={cn(
          side
            ? cn(
                "anim-sheet fixed right-0 top-0 z-50 flex h-dvh w-full flex-col glass-liquid shadow-elev-4 text-bone pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
                SIDE_WIDTH[width],
              )
            : cn(
                // Phone: full screen, rising from the bottom like an iOS sheet.
                "anim-modal fixed inset-0 z-50 flex min-w-0 flex-col glass-liquid shadow-elev-4 text-bone",
                "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
                // From 640px: a centered modal, Dialog's look at detail width.
                "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[90dvh] sm:w-[calc(100vw-3rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-chrome sm:overflow-hidden sm:pt-0 sm:pb-0",
                CENTER_WIDTH[width],
              ),
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className={cn(
            "absolute right-4 top-[calc(1rem_+_env(safe-area-inset-top))] z-10 rounded-sm p-1 text-steel/70 outline-none transition-colors hover:bg-coal-3 hover:text-bone focus-visible:ring-2 focus-visible:ring-gold/30",
            !side && "sm:top-4",
          )}
          aria-label="Close"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shrink-0 space-y-1 border-b border-graphite/50 py-5 pl-5 pr-12 sm:pl-6", className)}
      {...props}
    />
  );
}

export function SheetTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("font-grotesk text-lg font-semibold tracking-tight text-bone", className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-steel", className)} {...props} />;
}

export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shrink-0 flex items-center gap-2 border-t border-graphite/50 px-5 py-4 sm:px-6", className)}
      {...props}
    />
  );
}
