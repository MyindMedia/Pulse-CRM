/* The bookings day board's arithmetic, kept pure so it is testable: which
 * bookings belong on a day, the hour range the timeline shows, where each
 * block sits, and the "Today at a glance" figures. No React, no Convex. */

import type { BookingRow } from "@/components/bookings/types";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
/** Same bookable-day baseline as reports.roomUtilization. */
export const BOOKABLE_HOURS_PER_DAY = 12;

const DEAD = new Set(["cancelled", "no_show"]);

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Monday 00:00 of the week containing `ts` (weeks start on Monday, like the schedule). */
export function startOfWeek(ts: number): number {
  const d = new Date(ts);
  const dow = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow).getTime();
}

/** Local midnight `n` days after `dayStart` (DST-safe). */
export function addDays(dayStart: number, n: number): number {
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

/** Bookings that touch [dayStart, next day), cancelled ones left off the board. */
export function bookingsOn(rows: BookingRow[], dayStart: number): BookingRow[] {
  const end = addDays(dayStart, 1);
  return rows
    .filter((s) => s.status !== "cancelled" && s.startTime < end && s.endTime > dayStart)
    .sort((a, b) => a.startTime - b.startTime);
}

/** The hours the timeline shows: at least 10:00 to 22:00, widened to fit
 *  every booking that day (24 = midnight). */
export function hourRange(day: BookingRow[], dayStart: number): { from: number; to: number } {
  let from = 10;
  let to = 22;
  for (const s of day) {
    const start = Math.max(0, (s.startTime - dayStart) / HOUR);
    const end = Math.min(24, (s.endTime - dayStart) / HOUR);
    from = Math.min(from, Math.floor(start));
    to = Math.max(to, Math.ceil(end));
  }
  return { from: Math.max(0, from), to: Math.min(24, Math.max(to, from + 1)) };
}

/** Left and width (percent of the track) for a booking within the range. */
export function blockGeometry(
  s: { startTime: number; endTime: number },
  dayStart: number,
  range: { from: number; to: number },
): { left: number; width: number } {
  const span = range.to - range.from;
  const start = Math.max(range.from, (s.startTime - dayStart) / HOUR);
  const end = Math.min(range.to, (s.endTime - dayStart) / HOUR);
  return { left: ((start - range.from) / span) * 100, width: (Math.max(0, end - start) / span) * 100 };
}

/** The booking to select by default: the one running now, else the next one,
 *  else the first of the day. */
export function defaultSelection(day: BookingRow[], now: number): BookingRow | null {
  const live = day.find((s) => !DEAD.has(s.status) && s.startTime <= now && s.endTime > now);
  if (live) return live;
  return day.find((s) => !DEAD.has(s.status) && s.startTime > now) ?? day[0] ?? null;
}

function hoursOn(rows: BookingRow[], from: number, to: number): number {
  return (
    rows
      .filter((s) => !DEAD.has(s.status))
      .reduce((sum, s) => sum + Math.max(0, Math.min(s.endTime, to) - Math.max(s.startTime, from)), 0) / HOUR
  );
}

export type Glance = {
  bookedHours: number;
  bookedDelta: number | null; // vs the same weekday a week earlier
  openHours: number;
  depositsDueCents: number; // unpaid deposits on bookings in the next 7 days
  depositsDueCount: number;
  noShows30: number;
  noShowsDelta: number | null; // vs the 30 days before that
  sessions: number;
};

/** "Today at a glance" for the board's day, from bookings already loaded. */
export function glanceFor(rows: BookingRow[], dayStart: number, rooms: number, now: number): Glance {
  const dayEnd = addDays(dayStart, 1);
  const bookedHours = Math.round(hoursOn(rows, dayStart, dayEnd) * 10) / 10;
  const lastWeek = hoursOn(rows, addDays(dayStart, -7), addDays(dayStart, -6));
  const weekAhead = now + 7 * DAY;
  const due = rows.filter(
    (s) => !DEAD.has(s.status) && !s.depositPaid && s.depositCents > 0 && s.endTime > now && s.startTime < weekAhead,
  );
  const noShowsIn = (from: number, to: number) =>
    rows.filter((s) => s.status === "no_show" && s.startTime >= from && s.startTime < to).length;
  const noShows30 = noShowsIn(now - 30 * DAY, now);
  const prior = noShowsIn(now - 60 * DAY, now - 30 * DAY);
  return {
    bookedHours,
    bookedDelta: lastWeek > 0 ? (bookedHours - lastWeek) / lastWeek : null,
    openHours: Math.max(0, Math.round((rooms * BOOKABLE_HOURS_PER_DAY - bookedHours) * 10) / 10),
    depositsDueCents: due.reduce((sum, s) => sum + s.depositCents, 0),
    depositsDueCount: due.length,
    noShows30,
    noShowsDelta: prior > 0 ? (noShows30 - prior) / prior : null,
    sessions: rows.filter((s) => !DEAD.has(s.status) && s.startTime >= dayStart && s.startTime < dayEnd).length,
  };
}
