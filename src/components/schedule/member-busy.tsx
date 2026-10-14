"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

const DAY = 86_400_000;

type Busy = { startTime: number; endTime: number; allDay: boolean };

function fmt(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "");
}

/** memberId -> day index (0 = week start) -> busy intervals from members' personal
 *  Google calendars. Titles are never loaded. */
export function useMemberBusy(weekStart: number, weekEnd: number): Record<string, Record<number, Busy[]>> {
  const rows = useQuery(api.memberCalendar.busyInRange, { from: weekStart, to: weekEnd });
  return React.useMemo(() => {
    const out: Record<string, Record<number, Busy[]>> = {};
    for (const r of rows ?? []) {
      const first = Math.max(0, Math.floor((r.startTime - weekStart) / DAY));
      const last = Math.min(6, Math.floor((r.endTime - 1 - weekStart) / DAY));
      for (let di = first; di <= last; di++) ((out[r.memberId] ??= {})[di] ??= []).push(r);
    }
    return out;
  }, [rows, weekStart]);
}

/** "Busy" chips for one cell of the staff schedule. */
export function BusyChips({ items }: { items?: Busy[] }) {
  if (!items?.length) return null;
  return (
    <>
      {items.map((b, i) => (
        <span
          key={i}
          className="rounded-md border border-dashed border-graphite/60 bg-coal-2/60 px-1.5 py-1 text-[0.6875rem] leading-tight text-steel"
          title="Busy on a personal calendar"
        >
          Busy{b.allDay ? " all day" : ` ${fmt(b.startTime)}-${fmt(b.endTime)}`}
        </span>
      ))}
    </>
  );
}
