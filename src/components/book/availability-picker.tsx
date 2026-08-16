"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Minus, Plus, CalendarX2 } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Local midnight (ms) for an offset of N days from today. */
function dayStartFor(offset: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.getTime();
}

const DAY_COUNT = 15; // today + next 14 days

export type SlotSelection = {
  startTime: number;
  durationHours: number;
};

/**
 * Date strip + hourly slot grid + duration stepper. Validates that the chosen
 * duration fits in consecutive available slots and inside closing time, then
 * reports `{ startTime, durationHours }` upward (or `null` when incomplete).
 */
export function AvailabilityPicker({
  roomId,
  minimumHours,
  hourlyRateCents,
  depositPct,
  closeHour,
  onChange,
}: {
  roomId: Id<"rooms">;
  minimumHours: number;
  hourlyRateCents: number;
  depositPct: number;
  closeHour: number;
  onChange: (selection: SlotSelection | null) => void;
}) {
  const days = React.useMemo(
    () => Array.from({ length: DAY_COUNT }, (_, i) => dayStartFor(i)),
    [],
  );
  const [dayStart, setDayStart] = React.useState(days[0]);
  const [startHour, setStartHour] = React.useState<number | null>(null);
  const [durationHours, setDurationHours] = React.useState(minimumHours);

  const data = useQuery(api.booking.availability, { roomId, dayStart });

  // Reset the chosen slot whenever the day changes.
  const [prevDayStart, setPrevDayStart] = React.useState(dayStart);
  if (prevDayStart !== dayStart) {
    setPrevDayStart(dayStart);
    setStartHour(null);
  }

  // Set of hours that are open for booking on the active day.
  const availableHours = React.useMemo(() => {
    const set = new Set<number>();
    data?.slots.forEach((s) => {
      if (s.available) set.add(s.hour);
    });
    return set;
  }, [data]);

  // Does `[start, start+duration)` sit entirely in open, consecutive slots?
  const fits = React.useCallback(
    (start: number, hours: number) => {
      if (start + hours > closeHour) return false;
      for (let h = start; h < start + hours; h++) {
        if (!availableHours.has(h)) return false;
      }
      return true;
    },
    [availableHours, closeHour],
  );

  // Longest bookable run starting at `startHour` (caps the duration stepper).
  const maxDuration = React.useMemo(() => {
    if (startHour === null) return minimumHours;
    let hours = 0;
    while (fits(startHour, hours + 1)) hours++;
    return Math.max(minimumHours, hours);
  }, [startHour, fits, minimumHours]);

  // Keep duration valid against the current start slot.
  const [prevBounds, setPrevBounds] = React.useState({ maxDuration, minimumHours });
  if (prevBounds.maxDuration !== maxDuration || prevBounds.minimumHours !== minimumHours) {
    setPrevBounds({ maxDuration, minimumHours });
    setDurationHours((d) => Math.min(Math.max(d, minimumHours), maxDuration));
  }

  // Report the resolved selection upward.
  const selectionValid =
    startHour !== null && fits(startHour, durationHours) && durationHours >= minimumHours;

  React.useEffect(() => {
    if (selectionValid && startHour !== null) {
      onChange({ startTime: dayStart + startHour * 3_600_000, durationHours });
    } else {
      onChange(null);
    }
  }, [selectionValid, startHour, durationHours, dayStart, onChange]);

  const rateCents = hourlyRateCents * durationHours;
  const depositCents = Math.round((rateCents * depositPct) / 100);

  function selectSlot(hour: number) {
    setStartHour(hour);
    // Snap duration to the largest run that fits, capped at the current value.
    let run = 0;
    while (run < closeHour - hour && availableHours.has(hour + run)) run++;
    setDurationHours(Math.min(Math.max(minimumHours, durationHours), Math.max(minimumHours, run)));
  }

  return (
    <div className="space-y-5">
      {/* Date strip */}
      <div>
        <p className="overline mb-2">Choose a date</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {days.map((ms) => {
            const d = new Date(ms);
            const active = ms === dayStart;
            const isToday = ms === days[0];
            return (
              <button
                key={ms}
                type="button"
                onClick={() => setDayStart(ms)}
                className={cn(
                  "flex shrink-0 flex-col items-center rounded-md border px-3 py-2 text-center transition-colors",
                  active
                    ? "border-gold bg-gold/10 text-gold-bright"
                    : "border-graphite/60 bg-coal-2 text-steel hover:border-gold-dim hover:text-bone",
                )}
              >
                <span className="text-[0.625rem] font-meta uppercase tracking-wide">
                  {isToday ? "Today" : d.toLocaleDateString("en-US", { weekday: "short" })}
                </span>
                <span className="font-grotesk text-base font-semibold leading-tight">
                  {d.getDate()}
                </span>
                <span className="text-[0.625rem] text-steel/70">
                  {d.toLocaleDateString("en-US", { month: "short" })}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Slot grid */}
      <div>
        <p className="overline mb-2">Pick a start time</p>
        {data === undefined ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : data.slots.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-graphite/60 bg-coal/40 px-4 py-6 text-sm text-steel/70">
            <CalendarX2 className="size-4" />
            No open hours on this date.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {data.slots.map((slot) => {
              const selected = startHour === slot.hour;
              const inRange =
                startHour !== null &&
                slot.hour > startHour &&
                slot.hour < startHour + durationHours &&
                selectionValid;
              return (
                <button
                  key={slot.hour}
                  type="button"
                  disabled={!slot.available}
                  onClick={() => selectSlot(slot.hour)}
                  className={cn(
                    "rounded-md border py-2.5 text-center font-meta text-sm transition-colors",
                    !slot.available &&
                      "cursor-not-allowed border-graphite/50 bg-coal/40 text-steel/70 line-through",
                    slot.available &&
                      !selected &&
                      !inRange &&
                      "border-graphite/60 bg-coal-2 text-bone hover:border-gold-dim",
                    selected && "border-gold bg-gold text-gold-ink font-semibold",
                    inRange && "border-gold-dim bg-gold/15 text-gold-bright",
                  )}
                >
                  {formatHour(slot.hour)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Duration + price */}
      {startHour !== null && (
        <div className="space-y-3 rounded-lg border border-graphite/50 bg-coal-2 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-bone">Session length</p>
              <p className="text-xs text-steel/70">
                {minimumHours}h minimum
                {maxDuration < minimumHours + 1
                  ? " - no longer block available from here"
                  : ` - up to ${maxDuration}h from this slot`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <IconButton
                type="button"
                variant="outline"
                size="icon-sm"
                label="Shorter session"
                disabled={durationHours <= minimumHours}
                onClick={() => setDurationHours((d) => Math.max(minimumHours, d - 1))}
              >
                <Minus className="size-4" />
              </IconButton>
              <span className="w-14 text-center font-grotesk text-lg font-semibold text-bone">
                {durationHours}h
              </span>
              <IconButton
                type="button"
                variant="outline"
                size="icon-sm"
                label="Longer session"
                disabled={durationHours >= maxDuration}
                onClick={() => setDurationHours((d) => Math.min(maxDuration, d + 1))}
              >
                <Plus className="size-4" />
              </IconButton>
            </div>
          </div>

          <div className="flex items-end justify-between border-t border-graphite/50 pt-3">
            <div>
              <p className="text-xs text-steel/70">
                {formatHour(startHour)} – {formatHour(startHour + durationHours)}
              </p>
              <p className="font-grotesk text-xl font-semibold text-bone">
                {money(rateCents)}
              </p>
            </div>
            <p className="text-right text-xs text-steel">
              Deposit to hold
              <span className="block font-meta text-sm text-gold-bright">
                {money(depositCents)}
              </span>
            </p>
          </div>

          {!selectionValid && (
            <p className="text-xs text-critical">
              That length runs past closing or into a booked slot - shorten it or
              pick an earlier start.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** 24h integer hour → "9 AM" / "10 PM" style label. */
function formatHour(hour: number) {
  const h = ((hour + 11) % 12) + 1;
  const suffix = hour < 12 || hour === 24 ? "AM" : "PM";
  return `${h} ${suffix}`;
}
