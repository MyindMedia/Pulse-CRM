import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const HOUR = 3_600_000;

describe("staff scheduling - shifts", () => {
  let t: ReturnType<typeof convexTest>;
  let memberId: string;
  beforeEach(async () => {
    t = convexTest(schema);
    memberId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
      return ctx.db.insert("members", { orgId: "pulse-demo", name: "Eng Ellis", role: "engineer", email: "ellis@demo.com", skills: [] });
    });
  });

  it("create schedules a shift (no conflict) and notifies the staff member", async () => {
    const now = Date.now();
    const res = await t.mutation(api.shifts.create, {
      memberId: memberId as never, startTime: now + HOUR, endTime: now + 4 * HOUR,
    });
    expect(res.conflict).toBe(false);
    const notif = await t.run(async (ctx) =>
      (await ctx.db.query("notifications").collect()).find((n) => n.recipient === "ellis@demo.com"));
    expect(notif?.kind).toBe("shift.assigned");
  });

  it("flags a conflict when a member's shifts overlap", async () => {
    const now = Date.now();
    await t.mutation(api.shifts.create, { memberId: memberId as never, startTime: now, endTime: now + 3 * HOUR });
    const res = await t.mutation(api.shifts.create, { memberId: memberId as never, startTime: now + HOUR, endTime: now + 2 * HOUR });
    expect(res.conflict).toBe(true);
  });

  it("whosWorking returns members on shift right now", async () => {
    const now = Date.now();
    await t.run(async (ctx) =>
      ctx.db.insert("shifts", {
        orgId: "pulse-demo", memberId: memberId as never,
        startTime: now - HOUR, endTime: now + HOUR, kind: "scheduled", status: "scheduled",
      }));
    const w = await t.query(api.shifts.whosWorking, {});
    expect(w.now.length).toBe(1);
    expect(w.now[0].memberName).toBe("Eng Ellis");
  });

  it("unstaffedSessions lists engineering gaps; assignEngineer clears them + auto-shifts", async () => {
    const now = Date.now();
    const sid = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: "pulse-demo", name: "Nova", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      return ctx.db.insert("sessions", {
        orgId: "pulse-demo", title: "Tracking", artistId, serviceType: "recording",
        startTime: now + 2 * HOUR, endTime: now + 5 * HOUR, status: "tentative",
        rateCents: 20000, depositCents: 6000, depositPaid: false, intakeCompleted: false,
      });
    });
    expect((await t.query(api.shifts.unstaffedSessions, {})).length).toBe(1);

    const res = await t.mutation(api.sessions.assignEngineer, { sessionId: sid as never, engineerId: memberId as never });
    expect(res.staffingWarning).toBeNull();
    expect((await t.query(api.shifts.unstaffedSessions, {})).length).toBe(0);
    const shift = await t.run(async (ctx) =>
      (await ctx.db.query("shifts").collect()).find((s) => s.kind === "session"));
    expect(shift?.memberId).toBe(memberId);
  });

  it("staffingSummary rolls up scheduled hours per member", async () => {
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("shifts", { orgId: "pulse-demo", memberId: memberId as never, startTime: now, endTime: now + 3 * HOUR, kind: "scheduled", status: "scheduled" });
      await ctx.db.insert("shifts", { orgId: "pulse-demo", memberId: memberId as never, startTime: now + 4 * HOUR, endTime: now + 6 * HOUR, kind: "session", status: "scheduled" });
      await ctx.db.insert("shifts", { orgId: "pulse-demo", memberId: memberId as never, startTime: now + 7 * HOUR, endTime: now + 9 * HOUR, kind: "scheduled", status: "cancelled" });
    });
    const sum = await t.query(api.shifts.staffingSummary, { from: now - HOUR, to: now + 24 * HOUR });
    expect(sum.length).toBe(1);
    expect(sum[0].hours).toBe(5); // 3 + 2 (cancelled excluded)
    expect(sum[0].shifts).toBe(2);
    expect(sum[0].sessions).toBe(1);
  });

  it("booking a session auto-creates the engineer's shift; double-booking warns", async () => {
    const now = Date.now();
    const base = {
      title: "Tracking", serviceType: "recording" as const, rateCents: 20000,
      clientName: "New Client", engineerId: memberId as never,
    };
    const first = await t.mutation(api.sessions.create, { ...base, startTime: now + HOUR, endTime: now + 3 * HOUR });
    expect(first.staffingWarning).toBeNull();
    const shift = await t.run(async (ctx) =>
      (await ctx.db.query("shifts").collect()).find((s) => s.kind === "session"));
    expect(shift?.memberId).toBe(memberId);

    // Overlapping second session for the same engineer → soft warning.
    const second = await t.mutation(api.sessions.create, { ...base, startTime: now + 2 * HOUR, endTime: now + 4 * HOUR });
    expect(second.staffingWarning).toMatch(/already booked/i);
  });
});
