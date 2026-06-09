"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { BookingCard } from "./booking-card";
import type { BookingRow } from "./types";

/**
 * One state group in the booking pipeline. Renders a labelled header
 * with a count and a stack of booking cards. Optionally collapsible -
 * used for the Released / Cancelled lane which starts closed.
 */
export function BookingLane({
  title,
  description,
  bookings,
  accent,
  collapsible,
  defaultOpen = true,
  onSelect,
}: {
  title: string;
  description: string;
  bookings: BookingRow[];
  accent: "gold" | "info" | "positive" | "neutral";
  collapsible?: boolean;
  defaultOpen?: boolean;
  onSelect: (booking: BookingRow) => void;
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  const dot = {
    gold: "bg-gold",
    info: "bg-info",
    positive: "bg-positive",
    neutral: "bg-ash-dim",
  }[accent];

  const headerInner = (
    <>
      {collapsible && (
        <ChevronRight
          className={cn(
            "size-3.5 text-steel/70 transition-transform",
            open && "rotate-90",
          )}
        />
      )}
      <span aria-hidden className={cn("size-2 rounded-full", dot)} />
      <h2 className="overline">{title}</h2>
      <span className="font-meta text-[0.6875rem] tabular-nums text-steel/70">
        {bookings.length}
      </span>
    </>
  );

  return (
    <section className="space-y-2.5">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-gold/30"
        >
          {headerInner}
        </button>
      ) : (
        <div className="flex w-full items-center gap-2 text-left">
          {headerInner}
        </div>
      )}

      {open && (
        <>
          {bookings.length === 0 ? (
            <p className="rounded-lg border border-dashed border-graphite/60 bg-coal/40 py-6 text-center text-xs text-steel/70">
              {description}
            </p>
          ) : (
            <div className="space-y-2">
              {bookings.map((b) => (
                <BookingCard
                  key={b._id}
                  booking={b}
                  onClick={() => onSelect(b)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
