import { describe, it, expect } from "vitest";
import { punchAlert, punchAudience } from "./punchAlert";

const TZ = "America/Los_Angeles";
// 2026-09-07 09:52 PT
const AT = Date.UTC(2026, 8, 7, 16, 52);

describe("the punch alert", () => {
  it("names the person, the moment and the room on a clock-in", () => {
    const a = punchAlert({ kind: "in", memberName: "Sienna Cole", at: AT, tz: TZ, roomName: "The Loft", onRota: true }, "e1");
    expect(a.title).toBe("Sienna Cole clocked in");
    expect(a.body).toBe("9:52 AM · The Loft");
    expect(a.tag).toBe("punch-in:e1");
  });

  it("says when a clock-in is off the rota, which is the one a manager acts on", () => {
    const a = punchAlert({ kind: "in", memberName: "Sienna Cole", at: AT, tz: TZ, onRota: false }, "e1");
    expect(a.body).toBe("9:52 AM · not on the rota");
  });

  it("carries the hours on a clock-out", () => {
    const a = punchAlert({ kind: "out", memberName: "Sienna Cole", at: AT, tz: TZ, hours: 7.8 }, "e1");
    expect(a.title).toBe("Sienna Cole clocked out");
    expect(a.body).toBe("9:52 AM · 7.8h on the clock");
    expect(a.tag).toBe("punch-out:e1");
  });
});

describe("who is told", () => {
  const team = [
    { _id: "m_owner", role: "owner", clerkUserId: "u_owner" },
    { _id: "m_mgr", role: "manager", clerkUserId: "u_mgr" },
    { _id: "m_mgr2", role: "manager", clerkUserId: null },
    { _id: "m_eng", role: "engineer", clerkUserId: "u_eng" },
    { _id: "m_acct", role: "accountant", clerkUserId: "u_acct" },
  ];
  it("is the owners and managers who can be reached, and nobody else", () => {
    expect(punchAudience(team, "m_eng")).toEqual(["u_owner", "u_mgr"]);
  });
  it("never tells the person about their own punch", () => {
    expect(punchAudience(team, "m_mgr")).toEqual(["u_owner"]);
  });
});
