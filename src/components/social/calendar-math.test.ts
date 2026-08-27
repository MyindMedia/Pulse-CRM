import { describe, it, expect } from "vitest";
import { monthBounds, monthGrid, dayKeyFor } from "./calendar-math";

describe("monthBounds", () => {
  it("covers the full month for a 31-day month", () => {
    // August 2026 (month index 7).
    const { from, to } = monthBounds(2026, 7);
    expect(new Date(from).toString()).toContain("Aug 01 2026 00:00:00");
    expect(new Date(to).toString()).toContain("Aug 31 2026 23:59:59");
  });

  it("covers a non-leap February correctly", () => {
    const { from, to } = monthBounds(2026, 1);
    expect(new Date(from).getDate()).toBe(1);
    expect(new Date(to).getDate()).toBe(28);
  });

  it("covers a leap February correctly", () => {
    const { from, to } = monthBounds(2028, 1);
    expect(new Date(from).getDate()).toBe(1);
    expect(new Date(to).getDate()).toBe(29);
  });

  it("rolls December into next January without special-casing the year", () => {
    const { to } = monthBounds(2026, 11);
    const end = new Date(to);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(11);
    expect(end.getDate()).toBe(31);
  });
});

describe("monthGrid", () => {
  it("returns full weeks of 7 columns, padded with the surrounding months", () => {
    // August 2026: Aug 1 is a Saturday, so the first row is padded with 6
    // days of July; Aug 31 is a Monday, so the last row is padded with days
    // of September.
    const weeks = monthGrid(2026, 7);
    for (const week of weeks) expect(week).toHaveLength(7);
    expect(weeks[0][0].inMonth).toBe(false); // trailing July day
    expect(weeks[0][6].day).toBe(1);
    expect(weeks[0][6].inMonth).toBe(true);
    const last = weeks[weeks.length - 1];
    expect(last.some((c) => !c.inMonth)).toBe(true); // leading September days
  });

  it("marks exactly one cell as today when now falls in this month", () => {
    const now = new Date(2026, 7, 15, 12, 0, 0).getTime();
    const weeks = monthGrid(2026, 7, now);
    const flat = weeks.flat();
    const todays = flat.filter((c) => c.isToday);
    expect(todays).toHaveLength(1);
    expect(todays[0].day).toBe(15);
  });

  it("marks no cell as today when now falls outside the padded grid entirely", () => {
    // Sept 15 2026 is well past August's trailing-padding days.
    const now = new Date(2026, 8, 15).getTime();
    const weeks = monthGrid(2026, 7, now);
    expect(weeks.flat().some((c) => c.isToday)).toBe(false);
  });

  it("lays out a month that starts on Sunday with no leading padding", () => {
    // November 2026: Nov 1 is a Sunday.
    const weeks = monthGrid(2026, 10);
    expect(weeks[0][0].day).toBe(1);
    expect(weeks[0][0].inMonth).toBe(true);
  });
});

describe("dayKeyFor", () => {
  it("gives the same key for two timestamps on the same local day", () => {
    const morning = new Date(2026, 7, 15, 1, 0, 0).getTime();
    const night = new Date(2026, 7, 15, 23, 59, 0).getTime();
    expect(dayKeyFor(morning)).toBe(dayKeyFor(night));
  });

  it("gives different keys across a day boundary", () => {
    const day1 = new Date(2026, 7, 15, 23, 59, 0).getTime();
    const day2 = new Date(2026, 7, 16, 0, 0, 1).getTime();
    expect(dayKeyFor(day1)).not.toBe(dayKeyFor(day2));
  });
});
