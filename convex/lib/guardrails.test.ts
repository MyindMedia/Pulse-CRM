import { describe, it, expect } from "vitest";
import {
  isReleasable,
  splitSheetRisks,
  pipelineRisks,
  songRisks,
  studioScheduleRisks,
  staffScheduleRisks,
  allRiskFlags,
  type SongLite,
  type OppLite,
  type SessionLite,
  type ShiftLite,
} from "./guardrails";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const HOUR = 3_600_000;

describe("isReleasable (split-sheet safeguard)", () => {
  it("permits stages before mastering regardless of split status", () => {
    expect(isReleasable("mixing", undefined)).toBe(true);
    expect(isReleasable("tracking", "draft")).toBe(true);
  });
  it("requires a fully executed split sheet at/after mastering", () => {
    expect(isReleasable("mastering", "fully_executed")).toBe(true);
    expect(isReleasable("mastering", "sent")).toBe(false);
    expect(isReleasable("released", undefined)).toBe(false);
    expect(isReleasable("delivered", "draft")).toBe(false);
  });
});

describe("splitSheetRisks", () => {
  it("flags only near-release songs without executed splits as critical", () => {
    const songs: SongLite[] = [
      { id: "s1", title: "Locked", stage: "mastering", splitStatus: "fully_executed", updatedAt: NOW },
      { id: "s2", title: "Exposed", stage: "delivered", splitStatus: "sent", updatedAt: NOW },
      { id: "s3", title: "Early", stage: "mixing", splitStatus: undefined, updatedAt: NOW },
    ];
    const flags = splitSheetRisks(songs);
    expect(flags).toHaveLength(1);
    expect(flags[0].entityId).toBe("s2");
    expect(flags[0].severity).toBe("critical");
    expect(flags[0].category).toBe("splitsheets");
  });
});

describe("pipelineRisks", () => {
  it("flags stale open deals and over-promised forecasts", () => {
    const opps: OppLite[] = [
      { id: "o1", title: "Fresh", stage: "qualified", valueCents: 1000, probability: 0.5, updatedAt: NOW - 2 * DAY },
      { id: "o2", title: "Cold", stage: "proposal", valueCents: 1000, probability: 0.5, updatedAt: NOW - 40 * DAY },
      { id: "o3", title: "Lying forecast", stage: "inquiry", valueCents: 1000, probability: 0.9, updatedAt: NOW - 40 * DAY },
      { id: "o4", title: "Closed", stage: "won", valueCents: 1000, probability: 1, updatedAt: NOW - 90 * DAY },
    ];
    const flags = pipelineRisks(opps, NOW);
    const keys = flags.map((f) => f.key);
    expect(keys).toContain("stale:o2");
    expect(keys).toContain("overpromise:o3");
    // o3 is also stale (>30d), so it produces both a stale and an overpromise flag.
    expect(keys).toContain("stale:o3");
    expect(keys).not.toContain("stale:o1");
    expect(flags.every((f) => f.entityId !== "o4")).toBe(true); // won is excluded
  });
});

describe("songRisks", () => {
  it("flags past-deadline (warning) and long-stalled (info) active songs", () => {
    const songs: SongLite[] = [
      { id: "s1", title: "Late", stage: "mixing", updatedAt: NOW - 2 * DAY, deadline: NOW - DAY },
      { id: "s2", title: "Stuck", stage: "tracking", updatedAt: NOW - 25 * DAY },
      { id: "s3", title: "Moving", stage: "editing", updatedAt: NOW - 2 * DAY },
      { id: "s4", title: "Done", stage: "delivered", updatedAt: NOW - 90 * DAY },
    ];
    const flags = songRisks(songs, NOW);
    const byId = Object.fromEntries(flags.map((f) => [f.entityId, f]));
    expect(byId["s1"].severity).toBe("warning");
    expect(byId["s2"].severity).toBe("info");
    expect(byId["s3"]).toBeUndefined();
    expect(byId["s4"]).toBeUndefined();
  });
});

describe("studioScheduleRisks", () => {
  it("flags overlapping same-room sessions as critical", () => {
    const sessions: SessionLite[] = [
      { id: "a", title: "A", roomId: "r1", engineerId: "e1", startTime: NOW + HOUR, endTime: NOW + 3 * HOUR, status: "confirmed" },
      { id: "b", title: "B", roomId: "r1", engineerId: "e2", startTime: NOW + 2 * HOUR, endTime: NOW + 4 * HOUR, status: "confirmed" },
      { id: "c", title: "C", roomId: "r2", engineerId: "e1", startTime: NOW + HOUR, endTime: NOW + 2 * HOUR, status: "confirmed" },
    ];
    const flags = studioScheduleRisks(sessions, NOW);
    const dbl = flags.filter((f) => f.key.startsWith("dbl:"));
    expect(dbl).toHaveLength(1);
    expect(dbl[0].severity).toBe("critical");
  });

  it("flags a soon-confirmed session with no engineer", () => {
    const sessions: SessionLite[] = [
      { id: "u", title: "Unstaffed", roomId: "r1", startTime: NOW + DAY, endTime: NOW + DAY + 2 * HOUR, status: "confirmed" },
    ];
    const flags = studioScheduleRisks(sessions, NOW);
    expect(flags.some((f) => f.key === "unstaffed:u")).toBe(true);
  });
});

describe("staffScheduleRisks", () => {
  const members = [
    { id: "e1", name: "Ava" },
    { id: "e2", name: "Ben" },
  ];

  it("flags rolling-7-day overtime", () => {
    // Ava: 5 shifts x 10h within a week = 50h > 45h threshold.
    const shifts: ShiftLite[] = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      memberId: "e1",
      startTime: NOW + i * DAY,
      endTime: NOW + i * DAY + 10 * HOUR,
      status: "scheduled",
    }));
    const flags = staffScheduleRisks(shifts, members, [], [], NOW);
    expect(flags.some((f) => f.key === "ot:e1")).toBe(true);
  });

  it("flags a shift overlapping approved time-off", () => {
    const shifts: ShiftLite[] = [{ id: "s1", memberId: "e1", startTime: NOW + DAY, endTime: NOW + DAY + 4 * HOUR, status: "scheduled" }];
    const timeOff = [{ memberId: "e1", startTime: NOW + DAY - HOUR, endTime: NOW + DAY + 8 * HOUR, status: "approved" }];
    const flags = staffScheduleRisks(shifts, members, [], timeOff, NOW);
    expect(flags.some((f) => f.key === "offclash:s1")).toBe(true);
  });

  it("flags single-engineer dependency when one carries the load", () => {
    const shifts: ShiftLite[] = [
      { id: "a", memberId: "e1", startTime: NOW + DAY, endTime: NOW + DAY + 25 * HOUR, status: "scheduled" },
      { id: "b", memberId: "e2", startTime: NOW + 2 * DAY, endTime: NOW + 2 * DAY + 3 * HOUR, status: "scheduled" },
    ];
    const flags = staffScheduleRisks(shifts, members, [], [], NOW);
    expect(flags.some((f) => f.key === "spof:e1")).toBe(true);
    expect(flags.find((f) => f.key === "spof:e1")?.severity).toBe("info");
  });
});

describe("allRiskFlags", () => {
  it("aggregates every category and sorts critical-first", () => {
    const flags = allRiskFlags({
      now: NOW,
      songs: [{ id: "s1", title: "Exposed", stage: "released", splitStatus: "sent", updatedAt: NOW }],
      opps: [{ id: "o1", title: "Cold", stage: "proposal", valueCents: 1, probability: 0.5, updatedAt: NOW - 40 * DAY }],
      sessions: [],
      shifts: [],
      members: [],
      availability: [],
      timeOff: [],
    });
    expect(flags.length).toBeGreaterThanOrEqual(2);
    expect(flags[0].severity).toBe("critical"); // split-sheet flag floats to the top
  });
});
