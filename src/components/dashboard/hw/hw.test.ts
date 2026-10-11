import { describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({ useQuery: () => undefined, useMutation: () => vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { pickLive } = await import("./live-hero");
const { statusChip } = await import("./todays-sessions");
const { elapsed, usd } = await import("./parts");

const HOUR = 3_600_000;
const NOW = new Date("2026-10-11T15:00:00").getTime();
const row = (start: number, hours: number, extra: Record<string, unknown> = {}) =>
  ({
    _id: `s${start}`, title: "Tracking", clientName: "Nova Vega", roomId: "r1", roomName: "Studio A",
    engineerName: "J. Ortiz", serviceType: "recording", customService: undefined,
    startTime: start, endTime: start + hours * HOUR, status: "confirmed",
    rateCents: 60000, outstandingCents: 40000, depositPaid: true, ...extra,
  }) as never;

describe("live hero: what is happening now", () => {
  it("picks the confirmed session spanning now, and the next one after it", () => {
    const done = row(NOW - 5 * HOUR, 2);
    const live = row(NOW - HOUR, 3);
    const next = row(NOW + 3 * HOUR, 2);
    expect(pickLive([done, live, next], NOW)).toEqual({ live, next });
  });

  it("never treats a cancelled or tentative booking as live, and skips dead ones as next", () => {
    const held = row(NOW - HOUR, 3, { status: "tentative" });
    const cancelled = row(NOW + HOUR, 1, { status: "cancelled" });
    const later = row(NOW + 2 * HOUR, 1);
    expect(pickLive([held, cancelled, later], NOW)).toEqual({ live: null, next: later });
  });
});

describe("today's sessions: the status word", () => {
  it("shows where the money stands to money roles", () => {
    expect(statusChip(row(NOW - HOUR, 3, { outstandingCents: 0 }), NOW, true).label).toBe("Paid");
    expect(statusChip(row(NOW - HOUR, 3), NOW, true).label).toBe("Deposit");
    expect(statusChip(row(NOW + HOUR, 3, { depositPaid: false }), NOW, true).label).toBe("Unpaid");
    expect(statusChip(row(NOW - 4 * HOUR, 2), NOW, true)).toEqual({ label: "Balance due", tone: "critical" });
  });

  it("shows where the booking stands to everyone else, never money", () => {
    const noMoney = { rateCents: null, outstandingCents: null, depositPaid: null };
    expect(statusChip(row(NOW - HOUR, 3, noMoney), NOW, false).label).toBe("Live");
    expect(statusChip(row(NOW + HOUR, 1, { ...noMoney, status: "tentative" }), NOW, false).label).toBe("Hold");
    expect(statusChip(row(NOW - 4 * HOUR, 2, noMoney), NOW, false).label).toBe("Done");
  });
});

describe("figures", () => {
  it("formats timers and money the kit's way", () => {
    expect(elapsed(2 * HOUR + 14 * 60_000 + 37_000)).toBe("02:14:37");
    expect(usd(4825000)).toBe("$48,250");
    expect(usd(60000, { cents: true })).toBe("$600.00");
  });
});

describe("period keys", () => {
  it("bounds today, this week (from Monday) and this month in local time, with the period before", async () => {
    const { periodBounds } = await import("./period");
    const wed = new Date(2026, 9, 14, 15, 30); // Wednesday 14 October 2026
    const day = periodBounds("day", wed);
    expect([day.start, day.end, day.prevStart, day.prevEnd]).toEqual([
      new Date(2026, 9, 14).getTime(), new Date(2026, 9, 15).getTime(), new Date(2026, 9, 13).getTime(), new Date(2026, 9, 14).getTime(),
    ]);
    expect(day).toMatchObject({ title: "Today", against: "yesterday" });
    const week = periodBounds("week", wed);
    expect(new Date(week.start).getDay()).toBe(1); // Monday
    expect(week.start).toBe(new Date(2026, 9, 12).getTime());
    expect(week.prevStart).toBe(new Date(2026, 9, 5).getTime());
    const month = periodBounds("month", wed);
    expect(month).toMatchObject({ title: "October", against: "Sep" });
    expect(month.prevStart).toBe(new Date(2026, 8, 1).getTime());
  });
});
