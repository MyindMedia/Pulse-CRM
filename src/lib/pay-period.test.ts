import { describe, it, expect } from "vitest";
import { anchorToLocalMidnight, defaultAnchorDate, payPeriodFor } from "./pay-period";

const DAY = 86_400_000;

describe("pay-period math", () => {
  const now = new Date(2026, 6, 7, 19, 30); // Tue Jul 7 2026, 7:30pm local

  it("monthly: calendar month containing now, with offsets", () => {
    const cur = payPeriodFor("monthly", null, now);
    expect(cur.start).toBe(new Date(2026, 6, 1).getTime());
    expect(cur.end).toBe(new Date(2026, 7, 1).getTime());
    const last = payPeriodFor("monthly", null, now, -1);
    expect(last.start).toBe(new Date(2026, 5, 1).getTime());
    expect(last.end).toBe(new Date(2026, 6, 1).getTime());
    expect(cur.label).toMatch(/2026/);
  });

  it("biweekly: 14-day window aligned to the anchor, containing now", () => {
    // Anchor Mon Jun 29 -> current period Jun 29..Jul 12
    const cur = payPeriodFor("biweekly", "2026-06-29", now);
    expect(cur.start).toBe(new Date(2026, 5, 29).getTime());
    expect(cur.end).toBe(new Date(2026, 5, 29).getTime() + 14 * DAY);
    expect(cur.start).toBeLessThanOrEqual(now.getTime());
    expect(cur.end).toBeGreaterThan(now.getTime());
  });

  it("biweekly: old anchors roll forward in whole 14-day steps", () => {
    const fromOld = payPeriodFor("biweekly", "2026-01-05", now); // 13 periods later
    expect((fromOld.start - new Date(2026, 0, 5).getTime()) % (14 * DAY)).toBe(0);
    expect(fromOld.start).toBeLessThanOrEqual(now.getTime());
    expect(fromOld.end).toBeGreaterThan(now.getTime());
  });

  it("biweekly: offset -1 returns the previous window", () => {
    const cur = payPeriodFor("biweekly", "2026-06-29", now);
    const prev = payPeriodFor("biweekly", "2026-06-29", now, -1);
    expect(prev.end).toBe(cur.start);
    expect(prev.start).toBe(cur.start - 14 * DAY);
  });

  it("biweekly: a future anchor still yields a window containing now", () => {
    const cur = payPeriodFor("biweekly", "2026-07-20", now);
    expect(cur.start).toBeLessThanOrEqual(now.getTime());
    expect(cur.end).toBeGreaterThan(now.getTime());
  });

  it("anchorToLocalMidnight parses valid dates and falls back to today", () => {
    expect(anchorToLocalMidnight("2026-06-29", now)).toBe(new Date(2026, 5, 29).getTime());
    expect(anchorToLocalMidnight("junk", now)).toBe(new Date(2026, 6, 7).getTime());
    expect(anchorToLocalMidnight(null, now)).toBe(new Date(2026, 6, 7).getTime());
  });

  it("defaultAnchorDate is the most recent Monday", () => {
    expect(defaultAnchorDate(now)).toBe("2026-07-06"); // Mon before Tue Jul 7
    expect(defaultAnchorDate(new Date(2026, 6, 6))).toBe("2026-07-06"); // Monday itself
    expect(defaultAnchorDate(new Date(2026, 6, 12))).toBe("2026-07-06"); // Sunday
  });
});
