import { describe, it, expect } from "vitest";
import { zonedTimeToUtc, scheduleSuggestions, toDatetimeLocalValue, fromDatetimeLocalValue } from "./schedule-math";

describe("zonedTimeToUtc", () => {
  it("converts a winter (standard time) wall clock in Los Angeles to UTC", () => {
    // 2024-01-10 18:00 PST (UTC-8) is 2024-01-11 02:00 UTC.
    const ts = zonedTimeToUtc(2024, 1, 10, 18, 0, "America/Los_Angeles");
    expect(new Date(ts).toISOString()).toBe("2024-01-11T02:00:00.000Z");
  });

  it("converts a summer (daylight time) wall clock in Los Angeles to UTC", () => {
    // 2024-07-10 18:00 PDT (UTC-7) is 2024-07-11 01:00 UTC.
    const ts = zonedTimeToUtc(2024, 7, 10, 18, 0, "America/Los_Angeles");
    expect(new Date(ts).toISOString()).toBe("2024-07-11T01:00:00.000Z");
  });

  it("round-trips through toDatetimeLocalValue in the same zone", () => {
    const ts = zonedTimeToUtc(2024, 3, 5, 9, 30, "America/New_York");
    expect(toDatetimeLocalValue(ts, "America/New_York")).toBe("2024-03-05T09:30");
    expect(fromDatetimeLocalValue("2024-03-05T09:30", "America/New_York")).toBe(ts);
  });

  it("returns null for an incomplete datetime-local value", () => {
    expect(fromDatetimeLocalValue("2024-03-05", "America/New_York")).toBeNull();
    expect(fromDatetimeLocalValue("", "America/New_York")).toBeNull();
  });
});

describe("scheduleSuggestions", () => {
  const tz = "America/Los_Angeles";

  it("returns Tue 6pm, Thu 6pm and Sat 10am, all strictly in the future", () => {
    // 2024-01-08 is a Monday.
    const now = zonedTimeToUtc(2024, 1, 8, 9, 0, tz);
    const out = scheduleSuggestions(now, tz);
    expect(out.map((s) => s.label)).toEqual(["Tue 6:00 PM", "Thu 6:00 PM", "Sat 10:00 AM"]);
    for (const s of out) expect(s.scheduledFor).toBeGreaterThan(now);
    expect(out[0].scheduledFor).toBe(zonedTimeToUtc(2024, 1, 9, 18, 0, tz));
    expect(out[1].scheduledFor).toBe(zonedTimeToUtc(2024, 1, 11, 18, 0, tz));
    expect(out[2].scheduledFor).toBe(zonedTimeToUtc(2024, 1, 13, 10, 0, tz));
  });

  it("rolls to next week when today is the target weekday but the slot has passed", () => {
    // 2024-01-09 is a Tuesday; sample after 6pm so today's slot is gone.
    const now = zonedTimeToUtc(2024, 1, 9, 20, 0, tz);
    const out = scheduleSuggestions(now, tz);
    expect(out[0].scheduledFor).toBe(zonedTimeToUtc(2024, 1, 16, 18, 0, tz));
  });

  it("offers today's own slot when today is the target weekday and it is still comfortably ahead", () => {
    // 2024-01-09 is a Tuesday; sample well before 6pm.
    const now = zonedTimeToUtc(2024, 1, 9, 9, 0, tz);
    const out = scheduleSuggestions(now, tz);
    expect(out[0].scheduledFor).toBe(zonedTimeToUtc(2024, 1, 9, 18, 0, tz));
  });
});
