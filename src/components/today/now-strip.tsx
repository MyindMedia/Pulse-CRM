"use client";

import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { DoorOpen, DoorClosed } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { timeOfDay } from "@/lib/format";
import { cn } from "@/lib/utils";

type TodayData = FunctionReturnType<typeof api.today.today>;
type Room = TodayData["rooms"][number];

/** The "now" strip - every room and whether it's busy (and until when). The
 *  glanceable heartbeat an operator keeps in the corner of their eye all day. */
export function NowStrip({ rooms, now }: { rooms: Room[]; now: number }) {
  if (rooms.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {rooms.map((r) => {
        const busy = r.busyUntil !== null && r.busyUntil > now;
        return (
          <div
            key={r.roomId}
            className={cn(
              "rounded-chrome p-3.5 transition-colors",
              busy ? "material-thin border-gold-dim/50 bg-gold/[0.05]" : "material-thin",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 truncate font-grotesk text-sm font-semibold text-bone">
                {busy ? (
                  <DoorClosed className="size-3.5 shrink-0 text-gold" />
                ) : (
                  <DoorOpen className="size-3.5 shrink-0 text-steel/70" />
                )}
                <span className="truncate">{r.roomName}</span>
              </span>
              <Badge tone={busy ? "gold" : "neutral"} dot>
                {busy ? "In use" : "Free"}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-steel">
              {busy ? (
                <>
                  Busy until{" "}
                  <span className="font-medium text-bone">{timeOfDay(r.busyUntil!)}</span>
                  {r.busyWith ? <span className="text-steel/70"> · {r.busyWith}</span> : null}
                </>
              ) : r.nextStart ? (
                <>
                  Free until{" "}
                  <span className="font-medium text-bone">{timeOfDay(r.nextStart)}</span>
                </>
              ) : (
                <span className="text-steel/70">Open the rest of the day</span>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}
