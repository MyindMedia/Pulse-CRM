import { describe, expect, it } from "vitest";
import { addDays, blockGeometry, bookingsOn, defaultSelection, glanceFor, hourRange, startOfDay, startOfWeek } from "./board-model";
import type { BookingRow } from "@/components/bookings/types";

const H = 3_600_000;
const DAY0 = new Date(2026, 9, 9).getTime(); // Friday 9 October 2026, local midnight
let n = 0;
const row = (startH: number, hours: number, extra: Partial<BookingRow> = {}): BookingRow =>
  ({
    _id: `s${n++}`, title: "Session", artistId: "a1", artistName: "Kei Marlow", roomId: "r1", roomName: "Studio B",
    startTime: DAY0 + startH * H, endTime: DAY0 + (startH + hours) * H, status: "confirmed",
    rateCents: 45000, depositCents: 22500, depositPaid: true, amountPaidCents: 22500, ...extra,
  }) as BookingRow;

describe("bookings day board", () => {
  it("puts a day's bookings on the board, earliest first, and leaves cancelled ones off", () => {
    const a = row(15, 4);
    const b = row(10, 4);
    const gone = row(12, 1, { status: "cancelled" });
    const tomorrow = row(30, 2);
    expect(bookingsOn([a, b, gone, tomorrow], DAY0).map((s) => s._id)).toEqual([b._id, a._id]);
  });

  it("shows 10:00 to 22:00 by default and widens to fit an early start or a late night", () => {
    expect(hourRange([row(12, 2)], DAY0)).toEqual({ from: 10, to: 22 });
    expect(hourRange([row(8, 2), row(20, 6)], DAY0)).toEqual({ from: 8, to: 24 });
  });

  it("places a block by its share of the visible hours", () => {
    expect(blockGeometry(row(15, 4), DAY0, { from: 10, to: 22 })).toEqual({ left: (5 / 12) * 100, width: (4 / 12) * 100 });
    // A booking past the range end is clipped to it.
    expect(blockGeometry(row(20, 6), DAY0, { from: 10, to: 22 }).width).toBeCloseTo((2 / 12) * 100);
  });

  it("selects the booking running now, else the next one", () => {
    const morning = row(10, 2);
    const live = row(13, 3);
    const later = row(18, 2);
    expect(defaultSelection([morning, live, later], DAY0 + 14 * H)?._id).toBe(live._id);
    expect(defaultSelection([morning, later], DAY0 + 14 * H)?._id).toBe(later._id);
  });

  it("weeks start on Monday and day steps are calendar days", () => {
    expect(new Date(startOfWeek(DAY0)).getDay()).toBe(1);
    expect(startOfDay(DAY0 + 15 * H)).toBe(DAY0);
    expect(new Date(addDays(DAY0, 3)).getDate()).toBe(12);
  });

  it("at a glance: booked hours against the same day last week, open slots, deposits due, no-shows", () => {
    const now = DAY0 + 9 * H;
    const today = [row(10, 4), row(15, 4, { status: "tentative" }), row(12, 3, { status: "no_show" })];
    const lastWeek = [{ ...row(10, 4), startTime: DAY0 - 7 * 24 * H + 10 * H, endTime: DAY0 - 7 * 24 * H + 14 * H }];
    const unpaid = row(30, 2, { depositPaid: false, depositCents: 13500 });
    const pastNoShow = { ...row(0, 1, { status: "no_show" }), startTime: now - 5 * 24 * H, endTime: now - 5 * 24 * H + H };
    const g = glanceFor([...today, ...lastWeek, unpaid, pastNoShow], DAY0, 3, now);
    expect(g.bookedHours).toBe(8); // no-show hours do not count
    expect(g.bookedDelta).toBeCloseTo(1); // 8h against 4h
    expect(g.openHours).toBe(3 * 12 - 8);
    expect(g.depositsDueCents).toBe(13500);
    expect(g.noShows30).toBe(1); // only the one 5 days ago: today's starts after `now`
    expect(g.sessions).toBe(2);
  });
});
