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
import { BlockBand, blocksByDay, type RoomBlock } from "./room-blocks";
import { PendingChangeDot } from "./pending-change-dot";
import { pickVisiblePills } from "./visible-pills";

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
      data-drill="session"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(session._id);
      }}
      title={session.requestStatus === "pending" ? "Booking request, waiting on approval" : undefined}
      className={cn(
        "flex w-full items-center gap-1.5 overflow-hidden rounded-sm border border-graphite/50 bg-coal-2 px-1.5 py-1 text-left outline-none transition-colors hover:border-graphite/60 hover:bg-coal-3 focus-visible:ring-2 focus-visible:ring-gold/30",
        // A pending booking request reads differently at a glance.
        session.requestStatus === "pending" && "border-dashed border-caution/60",
      )}
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
        {session.requestStatus === "pending" && <span className="text-caution">Request · </span>}
        {session.title}
      </span>
      <PendingChangeDot sessionId={session._id} />
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
  onShowDay,
  blocks = [],
  roomNames = {},
  onOpenBlock,
}: {
  /** Opens the day view for one day: "+N more" uses it so no booking hides
   *  behind the three pills a cell has room for. */
  onShowDay?: (ts: number) => void;
  blocks?: RoomBlock[];
  roomNames?: Record<string, string>;
  onOpenBlock?: (b: RoomBlock) => void;
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

  const blockDays = blocksByDay(blocks, days);

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
          const visible = pickVisiblePills(dayList, 3);
          const overflow = dayList.length - visible.length;

          return (
            // The cell is not itself a control: it holds booking pills, and a
            // control inside a control is invalid and unreachable for screen
            // readers. A click on empty space still starts a booking; keyboard
            // users get the day number, a real button that does the same.
            <div
              key={dayTs}
              onClick={() => onPickDay(dayTs)}
              className={cn(
                "flex min-h-28 cursor-pointer flex-col gap-1 border-b border-r border-graphite/50 p-1.5 text-left transition-colors last:border-r-0 hover:bg-coal-2",
                !inMonth && "bg-obsidian/40",
              )}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPickDay(dayTs);
                }}
                aria-label={`New booking on ${new Date(dayTs).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`}
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-sm font-meta text-[0.6875rem] outline-none focus-visible:ring-2 focus-visible:ring-gold/30",
                  isToday && "bg-gold font-bold text-gold-ink",
                  !isToday && inMonth && "text-bone",
                  !isToday && !inMonth && "text-steel/70",
                )}
              >
                {new Date(dayTs).getDate()}
              </button>

              <div className="flex flex-col gap-1">
                {(blockDays.get(dayTs) ?? []).map((b) => (
                  <BlockBand
                    key={b._id}
                    block={b}
                    roomName={roomNames[b.roomId]}
                    onOpen={onOpenBlock ?? (() => {})}
                    compact
                  />
                ))}
                {visible.map((s) => (
                  <SessionPill key={s._id} session={s} onOpen={onOpenSession} />
                ))}
                {overflow > 0 &&
                  (onShowDay ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onShowDay(dayTs);
                      }}
                      className="self-start rounded-sm px-1 font-meta text-[0.5625rem] text-steel/70 outline-none hover:text-bone hover:underline focus-visible:ring-2 focus-visible:ring-gold/30"
                    >
                      +{overflow} more
                    </button>
                  ) : (
                    <span className="px-1 font-meta text-[0.5625rem] text-steel/70">
                      +{overflow} more
                    </span>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
