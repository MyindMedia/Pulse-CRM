"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { timeOfDay } from "@/lib/format";
import {
  WEEKDAY_LABELS,
  isSameDay,
  startOfDay,
  statusColor,
  type Session,
} from "./constants";

/** Pill for a single session inside a day cell. */
function SessionPill({
  session,
  onOpen,
}: {
  session: Session;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(session._id);
      }}
      className="flex w-full items-center gap-1.5 overflow-hidden rounded-sm border border-graphite/50 bg-coal-2 px-1.5 py-1 text-left outline-none transition-colors hover:border-graphite/60 hover:bg-coal-3 focus-visible:ring-2 focus-visible:ring-gold/30"
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: statusColor(session.status) }}
      />
      <span className="truncate font-meta text-[0.5625rem] text-steel/70">
        {timeOfDay(session.startTime)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[0.6875rem] font-medium text-bone">
        {session.title}
      </span>
    </button>
  );
}

/** A six-week month calendar grid of session pills. */
export function MonthGrid({
  days,
  month,
  sessions,
  onOpenSession,
  onPickDay,
}: {
  days: number[];
  month: number;
  sessions: Session[];
  onOpenSession: (id: string) => void;
  onPickDay: (ts: number) => void;
}) {
  // Stable "today" snapshot at mount keeps the render pure.
  const [today] = useState(() => startOfDay(Date.now()));

  const byDay = new Map<number, Session[]>();
  for (const s of sessions) {
    const key = startOfDay(s.startTime);
    const list = byDay.get(key);
    if (list) list.push(s);
    else byDay.set(key, [s]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.startTime - b.startTime);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-graphite/50 bg-coal">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-graphite/50 bg-obsidian">
        {WEEKDAY_LABELS.map((d) => (
          <div
            key={d}
            className="px-2 py-2 text-center font-meta text-[0.625rem] uppercase tracking-wide text-steel/70"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {days.map((dayTs) => {
          const inMonth = new Date(dayTs).getMonth() === month;
          const isToday = isSameDay(dayTs, today);
          const dayList = byDay.get(dayTs) ?? [];
          const visible = dayList.slice(0, 3);
          const overflow = dayList.length - visible.length;

          return (
            // The day cell can't be a <button> because it contains <SessionPill>
            // buttons - nested buttons are invalid HTML and trip React's hydration
            // checker. Use a div with role + keyboard handling to keep a11y.
            <div
              key={dayTs}
              role="button"
              tabIndex={0}
              onClick={() => onPickDay(dayTs)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPickDay(dayTs);
                }
              }}
              className={cn(
                "flex min-h-28 cursor-pointer flex-col gap-1 border-b border-r border-graphite/50 p-1.5 text-left outline-none transition-colors last:border-r-0 hover:bg-coal-2 focus-visible:ring-2 focus-visible:ring-gold/30",
                !inMonth && "bg-obsidian/40",
              )}
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-sm font-meta text-[0.6875rem]",
                  isToday && "bg-gold font-bold text-gold-ink",
                  !isToday && inMonth && "text-bone",
                  !isToday && !inMonth && "text-steel/70",
                )}
              >
                {new Date(dayTs).getDate()}
              </span>

              <div className="flex flex-col gap-1">
                {visible.map((s) => (
                  <SessionPill key={s._id} session={s} onOpen={onOpenSession} />
                ))}
                {overflow > 0 && (
                  <span className="px-1 font-meta text-[0.5625rem] text-steel/70">
                    +{overflow} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
