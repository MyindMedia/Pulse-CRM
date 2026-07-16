import { describe, it, expect } from "vitest";
import { computeT10Alerts, type T10Session, type T10Shift } from "./lib/t10";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

function session(over: Partial<T10Session>): T10Session {
  return {
    _id: "s1",
    startTime: NOW + 10 * MIN,
    endTime: NOW + 130 * MIN,
    status: "confirmed",
    artistName: "Nova",
    roomName: "Studio A",
    nextInRoom: null,
    ...over,
  };
}

describe("computeT10Alerts", () => {
  it("fires the arrival alert exactly in the T-10 window", () => {
    const due = computeT10Alerts(NOW, [session({})], []);
    expect(due).toHaveLength(1);
    expect(due[0].key).toBe("a10:s1");
    expect(due[0].title).toContain("Arrival in 10 minutes");
    expect(due[0].body).toContain("Nova");

    // 15 minutes out: not yet. 5 minutes out: window passed.
    expect(computeT10Alerts(NOW, [session({ startTime: NOW + 15 * MIN })], [])).toHaveLength(0);
    expect(computeT10Alerts(NOW, [session({ startTime: NOW + 5 * MIN })], [])).toHaveLength(0);
  });

  it("fires wrap-up at T-10 before the end, for in-progress sessions", () => {
    const due = computeT10Alerts(
      NOW,
      [session({ status: "in_progress", startTime: NOW - 60 * MIN, endTime: NOW + 10 * MIN })],
      [],
    );
    expect(due.map((a) => a.key)).toEqual(["w10:s1"]);
    expect(due[0].body).toContain("Files, billing, gear, notes");
  });

  it("fires studio refresh at end-time only when another booking follows", () => {
    const ended = session({
      status: "in_progress",
      startTime: NOW - 120 * MIN,
      endTime: NOW - MIN,
      nextInRoom: { artistName: "Mira", startTime: NOW + 45 * MIN },
    });
    const due = computeT10Alerts(NOW, [ended], []);
    expect(due.map((a) => a.key)).toEqual(["r:s1"]);
    expect(due[0].body).toContain("Mira");

    // No follow-up booking: quiet.
    expect(
      computeT10Alerts(NOW, [session({ ...ended, _id: "s2", nextInRoom: null })], []),
    ).toHaveLength(0);
  });

  it("fires shift change at T-10 and skips cancelled shifts", () => {
    const shifts: T10Shift[] = [
      { _id: "sh1", startTime: NOW + 10 * MIN, status: "scheduled", memberName: "Theo" },
      { _id: "sh2", startTime: NOW + 10 * MIN, status: "cancelled", memberName: "Gone" },
    ];
    const due = computeT10Alerts(NOW, [], shifts);
    expect(due.map((a) => a.key)).toEqual(["s10:sh1"]);
    expect(due[0].title).toContain("Shift change");
    expect(due[0].url).toBe("/schedule");
  });

  it("cancelled and no-show sessions never alert", () => {
    expect(computeT10Alerts(NOW, [session({ status: "cancelled" })], [])).toHaveLength(0);
  });
});
