"use client";

import * as React from "react";
import type { BookingRow } from "@/components/bookings/types";
import { hhmm } from "@/components/dashboard/hw/parts";
import { EntityLink } from "@/components/shell/entity-link";
import { addDays, blockGeometry, bookingsOn, hourRange, laneOf } from "./board-model";

export type BoardRoom = { _id: string; name: string; roomType?: string | null; status?: string };

const NO_ROOM = "__none__";
/** Width of one hour on the day board; a long day scrolls inside the screen. */
const HOUR_PX = 52;
/** Height of one lane of bookings on a room's track. */
const LANE_PX = 48;

/** Rooms that are bookable on the board, plus a row for bookings with no room. */
function boardRooms(rooms: BoardRoom[], day: BookingRow[]): BoardRoom[] {
  const live = rooms.filter((r) => r.status !== "retired");
  const hasNoRoom = day.some((s) => !s.roomId || !live.some((r) => r._id === s.roomId));
  return hasNoRoom ? [...live, { _id: NO_ROOM, name: "No room", roomType: "Not assigned" }] : live;
}

/** A real room's name opens its page; the "No room" row stays plain. */
function RoomName({ room }: { room: BoardRoom }) {
  if (room._id === NO_ROOM) return <>{room.name}</>;
  return (
    <EntityLink type="room" id={room._id} className="hover:underline">
      {room.name}
    </EntityLink>
  );
}

function inRoom(s: BookingRow, room: BoardRoom, rooms: BoardRoom[]) {
  if (room._id === NO_ROOM) return !s.roomId || !rooms.some((r) => r._id === s.roomId);
  return s.roomId === room._id;
}

/* One day, rooms by hours, on a screen (kit pulse-bookings.png). A booking
 * is a key on its room's track; the selected one is yellow, a hold is a
 * hatched outline, a no-show is dimmed; today gets the glowing now line. */
export function DayTimeline({
  rows,
  rooms,
  dayStart,
  now,
  selectedId,
  onSelect,
}: {
  rows: BookingRow[];
  rooms: BoardRoom[];
  dayStart: number;
  now: number;
  selectedId: string | null;
  onSelect: (s: BookingRow) => void;
}) {
  const day = bookingsOn(rows, dayStart);
  const range = hourRange(day, dayStart);
  const hours = Array.from({ length: range.to - range.from }, (_, i) => range.from + i);
  const list = boardRooms(rooms, day);
  const isToday = now >= dayStart && now < addDays(dayStart, 1);
  const nowPct = isToday ? (((now - dayStart) / 3_600_000 - range.from) / (range.to - range.from)) * 100 : null;
  const showNow = nowPct !== null && nowPct >= 0 && nowPct <= 100;

  return (
    <div className="pl-screen overflow-x-auto">
      <div className="px-3 pb-2" style={{ minWidth: 132 + hours.length * HOUR_PX }}>
        <div className="grid grid-cols-[132px_1fr] border-b border-white/[0.06]">
          <div className="pl-label py-3">Room</div>
          <div className="relative grid" style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}>
            {hours.map((h) => (
              <div key={h} className="py-3 font-mono text-[11px] text-steel">
                {String(h % 24).padStart(2, "0")}:00
              </div>
            ))}
          </div>
        </div>
        {list.length === 0 ? (
          <p className="py-8 text-center font-sans text-sm text-steel">Add a room to see bookings by room.</p>
        ) : (
          list.map((room) => {
            const here = day.filter((s) => inRoom(s, room, rooms));
            const lanes = laneOf(here);
            const laneCount = Math.max(1, ...Array.from(lanes.values(), (l) => l + 1));
            return (
            <div key={room._id} className="grid grid-cols-[132px_1fr] border-b border-white/[0.06] last:border-b-0">
              <div className="min-w-0 py-3 pr-3">
                <p className="truncate font-sans text-[13px] font-semibold leading-[18px] text-bone">
                  <RoomName room={room} />
                </p>
                {room.roomType && <p className="truncate font-sans text-[11px] leading-4 text-steel">{room.roomType}</p>}
              </div>
              <div
                className="pl-track relative"
                style={{ backgroundSize: `calc(100% / ${hours.length}) 100%`, height: 16 + laneCount * LANE_PX }}
              >
                {here.map((s) => {
                    const g = blockGeometry(s, dayStart, range);
                    const hold = s.status === "tentative";
                    const lane = lanes.get(s._id) ?? 0;
                    return (
                      <button
                        key={s._id}
                        type="button"
                        onClick={() => onSelect(s)}
                        data-selected={s._id === selectedId ? "true" : undefined}
                        data-hold={hold ? "true" : undefined}
                        data-dim={s.status === "no_show" ? "true" : undefined}
                        aria-pressed={s._id === selectedId}
                        aria-label={`${hold ? "Hold: " : ""}${s.artistName}, ${hhmm(s.startTime)} to ${hhmm(s.endTime)}`}
                        className="pl-block absolute min-w-0 overflow-hidden px-2.5 py-1"
                        style={{
                          left: `calc(${g.left}% + 2px)`,
                          width: `calc(${g.width}% - 4px)`,
                          top: 8 + lane * LANE_PX,
                          height: LANE_PX - 4,
                        }}
                      >
                        <span className="block truncate font-sans text-[13px] font-bold leading-[18px]">
                          {hold ? "Hold: " : ""}
                          {s.artistName}
                        </span>
                        <span className="block truncate font-mono text-[11px] leading-4 opacity-80">
                          {hhmm(s.startTime)} to {hhmm(s.endTime)}
                        </span>
                      </button>
                    );
                  })}
                {showNow && (
                  <span className="pl-nowline pointer-events-none absolute -bottom-px -top-px" style={{ left: `${nowPct}%` }} aria-hidden />
                )}
              </div>
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* A week, rooms by days: each day cell lists its bookings as small keys. */
export function WeekTimeline({
  rows,
  rooms,
  weekStart,
  now,
  selectedId,
  onSelect,
  onShowDay,
}: {
  rows: BookingRow[];
  rooms: BoardRoom[];
  weekStart: number;
  now: number;
  selectedId: string | null;
  onSelect: (s: BookingRow) => void;
  /** Opens one day on the day board, so bookings past the first three in a
   *  cell are never out of reach. */
  onShowDay?: (dayStart: number) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const week = rows.filter((s) => s.status !== "cancelled" && s.startTime < addDays(weekStart, 7) && s.endTime > weekStart);
  const list = boardRooms(rooms, week);
  return (
    <div className="pl-screen overflow-x-auto">
      <div className="min-w-[860px] px-3 pb-2">
        <div className="grid grid-cols-[132px_repeat(7,minmax(0,1fr))] border-b border-white/[0.06]">
          <div className="pl-label py-3">Room</div>
          {days.map((d) => {
            const today = now >= d && now < addDays(d, 1);
            return (
              <div key={d} className={`py-3 font-mono text-[11px] ${today ? "text-gold" : "text-steel"}`}>
                {new Date(d).toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}
              </div>
            );
          })}
        </div>
        {list.map((room) => (
          <div key={room._id} className="grid grid-cols-[132px_repeat(7,minmax(0,1fr))] border-b border-white/[0.06] last:border-b-0">
            <div className="min-w-0 py-3 pr-3">
              <p className="truncate font-sans text-[13px] font-semibold leading-[18px] text-bone">
                <RoomName room={room} />
              </p>
              {room.roomType && <p className="truncate font-sans text-[11px] leading-4 text-steel">{room.roomType}</p>}
            </div>
            {days.map((d) => {
              const cell = bookingsOn(week, d).filter((s) => inRoom(s, room, rooms));
              return (
                <div key={d} className="min-w-0 space-y-1 border-l border-white/[0.05] p-1.5">
                  {cell.slice(0, 3).map((s) => (
                    <button
                      key={s._id}
                      type="button"
                      onClick={() => onSelect(s)}
                      data-selected={s._id === selectedId ? "true" : undefined}
                      data-hold={s.status === "tentative" ? "true" : undefined}
                      data-dim={s.status === "no_show" ? "true" : undefined}
                      className="pl-block block w-full min-w-0 px-2 py-1"
                    >
                      <span className="block truncate font-mono text-[10px] leading-[14px] opacity-80">{hhmm(s.startTime)}</span>
                      <span className="block truncate font-sans text-[12px] font-bold leading-4">{s.artistName}</span>
                    </button>
                  ))}
                  {cell.length > 3 &&
                    (onShowDay ? (
                      <button
                        type="button"
                        onClick={() => onShowDay(d)}
                        className="rounded-sm px-1 font-mono text-[10px] text-steel outline-none hover:text-bone hover:underline focus-visible:ring-2 focus-visible:ring-gold/40"
                      >
                        +{cell.length - 3} more
                      </button>
                    ) : (
                      <p className="px-1 font-mono text-[10px] text-steel">+{cell.length - 3} more</p>
                    ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
