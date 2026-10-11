"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Chassis, ChassisTitle, EmptyWell, Groove } from "./parts";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/* Room utilization (kit 6.2): booked hours against a 12-hour bookable day
 * over the last 30 days (reports.roomUtilization). The busiest room is the
 * yellow focus, the rest are metal; the studio-wide average sits on the last
 * groove with the chrome knob. The kit's "monthly goal" row needs a goal the
 * studio has not set anywhere yet, so the average stands in its place. */
export function RoomUtilization() {
  const u = useQuery(api.reports.roomUtilization, {});

  return (
    <Chassis>
      <ChassisTitle title="Room utilization" bar={false} />
      {u === undefined ? (
        <div className="mt-5 flex-1" aria-busy />
      ) : u.rows.length === 0 ? (
        <div className="mt-5 flex flex-1">
          <EmptyWell>Add a room to see how busy it is.</EmptyWell>
        </div>
      ) : (
        <div className="mt-5 flex flex-1 flex-col gap-4">
          {u.rows.slice(0, 4).map((r, i) => (
            <div key={r.roomId}>
              <div className="mb-2 flex items-baseline justify-between gap-3 font-sans text-[13px] leading-[18px]">
                <span className="truncate text-mist">{r.roomName}</span>
                <span className="font-mono text-xs text-bone tabular-nums">{pct(r.utilization)}</span>
              </div>
              <Groove value={r.utilization} tone={i === 0 && r.utilization > 0 ? "yellow" : "metal"} />
            </div>
          ))}
          <div className="mt-auto pt-1">
            <div className="mb-2 flex items-baseline justify-between gap-3 font-sans text-[13px] leading-[18px]">
              <span className="text-mist">All rooms, {u.windowDays} days</span>
              <span className="font-mono text-xs text-bone tabular-nums">{pct(u.avgUtilization)}</span>
            </div>
            <Groove value={u.avgUtilization} tone="yellow" knob />
          </div>
        </div>
      )}
    </Chassis>
  );
}
