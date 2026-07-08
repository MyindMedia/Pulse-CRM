import { describe, it, expect } from "vitest";
import { clockedMs, startOfToday, startOfWeek, fmtDuration, fmtTicker } from "./timesheet";

const HOUR = 3_600_000;

describe("timesheet math", () => {
  it("clockedMs sums entries clocked-in inside the window, open entries up to now", () => {
    const now = 100 * HOUR;
    const entries = [
      { clockInAt: 10 * HOUR, clockOutAt: 13 * HOUR }, // 3h inside
      { clockInAt: 20 * HOUR, clockOutAt: 24 * HOUR }, // 4h inside
      { clockInAt: 98 * HOUR, clockOutAt: null }, // open: 2h so far, clock-in outside window
      { clockInAt: 5 * HOUR, clockOutAt: 6 * HOUR }, // before window
    ];
    expect(clockedMs(entries, 10 * HOUR, 90 * HOUR, now)).toBe(7 * HOUR);
    expect(clockedMs(entries, 90 * HOUR, 200 * HOUR, now)).toBe(2 * HOUR); // the open one
  });

  it("day + week starts are local midnights (week starts Monday)", () => {
    const tue = new Date(2026, 6, 7, 19, 30); // Tue Jul 7 2026
    expect(startOfToday(tue)).toBe(new Date(2026, 6, 7).getTime());
    expect(startOfWeek(tue)).toBe(new Date(2026, 6, 6).getTime()); // Mon Jul 6
    expect(startOfWeek(new Date(2026, 6, 12, 8))).toBe(new Date(2026, 6, 6).getTime()); // Sunday still Mon
  });

  it("formats durations and the live ticker", () => {
    expect(fmtDuration(0)).toBe("0m");
    expect(fmtDuration(45 * 60_000)).toBe("45m");
    expect(fmtDuration(6.5 * HOUR)).toBe("6h 30m");
    expect(fmtTicker(0)).toBe("0:00:00");
    expect(fmtTicker(2 * HOUR + 14 * 60_000 + 9_000)).toBe("2:14:09");
  });
});
