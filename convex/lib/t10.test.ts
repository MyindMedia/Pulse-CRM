import { describe, it, expect } from "vitest";
import { computeT10Alerts, type T10Shift } from "./t10";

const NOW = 1_700_000_000_000;
const MIN = 60_000;

function shift(over: Partial<T10Shift> = {}): T10Shift {
  return {
    _id: "sh1",
    startTime: NOW + 10 * MIN,
    status: "scheduled",
    memberName: "Dana",
    clerkUserId: "user_dana",
    clockedIn: false,
    ...over,
  };
}

const keys = (shifts: T10Shift[]) =>
  computeT10Alerts(NOW, [], shifts).map((a) => a.key.split(":")[0]);

describe("shift alerts", () => {
  it("tells the person their own shift is starting, not just the crew", () => {
    // "Shift change in 10 minutes" was the only one, and it goes to whoever is
    // already on shift - which is everyone except the person walking in.
    expect(keys([shift()])).toContain("you10");
    expect(keys([shift()])).toContain("s10");
  });

  it("nudges someone who is on the schedule and has not clocked in", () => {
    const started = shift({ startTime: NOW - 10 * MIN, clockedIn: false });
    expect(keys([started])).toContain("nc");
  });

  it("says nothing to someone whose clock is already running", () => {
    const started = shift({ startTime: NOW - 10 * MIN, clockedIn: true });
    expect(keys([started])).not.toContain("nc");
  });

  it("sends the nudge to that person alone", () => {
    // A studio-wide "Dana has not clocked in" is how a team learns to mute
    // Pulse. The audience is part of the alert, not a detail of the sweep.
    const started = shift({ startTime: NOW - 10 * MIN });
    const alert = computeT10Alerts(NOW, [], [started]).find((a) => a.key.startsWith("nc:"));
    expect(alert?.clerkUserIds).toEqual(["user_dana"]);
  });

  it("marks the personal nudge as strictly addressed", () => {
    // Both transports otherwise fall back to the whole studio when the named
    // person has no registered device - so without this flag the one alert
    // that must stay private is the one that goes to everybody.
    const started = shift({ startTime: NOW - 10 * MIN });
    const nudge = computeT10Alerts(NOW, [], [started]).find((a) => a.key.startsWith("nc:"));
    expect(nudge?.strictAudience).toBe(true);
    // And the crew alert must NOT be, or a studio with no phones goes silent.
    const crew = computeT10Alerts(NOW, [], [shift()]).find((a) => a.key.startsWith("s10:"));
    expect(crew?.strictAudience).toBeUndefined();
  });

  it("stays quiet when there is nobody to tell", () => {
    // A roster row for someone who has never signed in has no Clerk id, and a
    // personal alert with no audience would fall back to the whole studio.
    const started = shift({ startTime: NOW - 10 * MIN, clerkUserId: null });
    expect(keys([started])).not.toContain("nc");
    expect(keys([shift({ clerkUserId: null })])).not.toContain("you10");
  });

  it("does not nudge thirty seconds after the hour, or an hour later", () => {
    expect(keys([shift({ startTime: NOW - 30_000 })])).not.toContain("nc");
    expect(keys([shift({ startTime: NOW - 60 * MIN })])).not.toContain("nc");
  });

  it("ignores a cancelled shift entirely", () => {
    expect(keys([shift({ startTime: NOW - 10 * MIN, status: "cancelled" })])).toEqual([]);
  });
});
