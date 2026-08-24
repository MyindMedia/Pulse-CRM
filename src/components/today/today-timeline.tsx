"use client";

import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { CalendarClock, DoorOpen, Mic2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { money, timeOfDay, duration } from "@/lib/format";
import { SESSION_STATUS, meta, serviceLabel, titleCase } from "@/lib/labels";
import { cn } from "@/lib/utils";

type TodayData = FunctionReturnType<typeof api.today.today>;
type Session = TodayData["sessions"][number];

/** Today's sessions as a vertical timeline. Live sessions glow gold; each row
 *  carries a status chip and (for leadership) an outstanding-balance chip. */
export function TodayTimeline({
  sessions,
  now,
  onOpen,
}: {
  sessions: Session[];
  now: number;
  onOpen?: (id: string) => void;
}) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Nothing on the books today"
        description="When sessions are scheduled for today they'll line up here in time order."
      />
    );
  }

  return (
    <ul className="space-y-2">
      {sessions.map((s) => {
        const st = meta(SESSION_STATUS, s.status);
        const live = s.status === "in_progress";
        const past = s.endTime < now && !live;
        const owes = (s.outstandingCents ?? 0) > 0;
        return (
          <li key={s._id}>
            <button
              type="button"
              onClick={() => onOpen?.(s._id)}
              className={cn(
                "flex w-full items-stretch gap-3 rounded-chrome p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gold/30",
                live
                  ? "material-thin border-gold-dim/50 bg-gold/[0.05]"
                  : "material-thin hover:bg-coal-2",
                past && "opacity-70",
              )}
            >
              {/* Time rail */}
              <div className="flex w-16 shrink-0 flex-col items-center justify-center border-r border-hairline pr-3 text-center">
                <span className="font-grotesk text-sm font-bold tracking-tight text-bone">
                  {timeOfDay(s.startTime)}
                </span>
                <span className="mt-0.5 text-[0.625rem] text-steel/70">
                  {duration(s.startTime, s.endTime)}
                </span>
              </div>

              {/* Body */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-grotesk text-sm font-semibold text-bone">
                    {s.title}
                  </span>
                  {live && (
                    <span className="inline-flex size-1.5 shrink-0 animate-pulse rounded-full bg-gold" />
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-steel">
                  {s.clientName}
                  <span className="text-steel/60"> · {serviceLabel(s.serviceType, s.customService)}</span>
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.6875rem] text-steel/70">
                  {s.roomName && (
                    <span className="inline-flex items-center gap-1">
                      <DoorOpen className="size-3" />
                      {s.roomName}
                    </span>
                  )}
                  {s.engineerName && (
                    <span className="inline-flex items-center gap-1">
                      <Mic2 className="size-3" />
                      {s.engineerName}
                    </span>
                  )}
                </div>
              </div>

              {/* Chips */}
              <div className="flex shrink-0 flex-col items-end justify-center gap-1.5">
                <Badge tone={st.tone}>{st.label}</Badge>
                {owes && (
                  <Badge tone="caution">{money(s.outstandingCents!, { compact: true })} due</Badge>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
