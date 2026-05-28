import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const ORG = "pulse-demo"; // demo viewer = owner with schedule.manage

describe("shifts - closures + change notifications", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Demo", slug: "demo", plan: "studio", status: "active" });
    });
  });

  it("closedDaysInRange flags holidays but treats Sundays as working days", async () => {
    const from = new Date("2026-05-24T00:00:00").getTime(); // Sunday
    const to = new Date("2026-05-26T00:00:00").getTime();   // through Tue
    const res = await t.query(api.shifts.closedDaysInRange, { from, to });
    const reasons = res.map((r) => r.reason);
    expect(reasons).not.toContain("Sunday"); // studios run Sundays
    expect(reasons).toContain("Memorial Day");
    // Tuesday the 26th is a working day - not listed.
    expect(res.some((r) => new Date(r.date).getDate() === 26)).toBe(false);
    // Sunday the 24th is now a working day - not listed.
    expect(res.some((r) => new Date(r.date).getDate() === 24)).toBe(false);
  });

  it("editing a shift notifies the team member; cancelling does too", async () => {
    const memberId = await t.run((ctx) =>
      ctx.db.insert("members", { orgId: ORG, name: "Theo", role: "engineer", email: "theo@demo.com", skills: [] }),
    );
    const startTime = new Date("2026-06-02T10:00:00").getTime();
    const { shiftId } = await t.mutation(api.shifts.create, { memberId, startTime, endTime: startTime + 8 * 3_600_000 });

    await t.mutation(api.shifts.update, { shiftId, startTime: startTime + 3_600_000, endTime: startTime + 9 * 3_600_000 });
    await t.mutation(api.shifts.cancel, { shiftId });

    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    const kinds = notes.filter((n) => n.recipient === "theo@demo.com").map((n) => n.kind);
    expect(kinds).toContain("shift.assigned"); // create
    expect(kinds).toContain("shift.updated");  // edit
    expect(kinds).toContain("shift.cancelled"); // cancel
  });
});
