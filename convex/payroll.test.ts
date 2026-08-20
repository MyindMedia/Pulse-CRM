import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { hoursBetween, hourlyPayCents, salaryPeriodCents, memberPay } from "./lib/payroll";

const HOUR = 3_600_000;
const YEAR = 365 * 86_400_000;

describe("payroll math (pure)", () => {
  it("hours + hourly pay", () => {
    expect(hoursBetween(0, 2 * HOUR)).toBe(2);
    expect(hoursBetween(5 * HOUR, 0)).toBe(0); // never negative
    expect(hourlyPayCents(3, 3_500)).toBe(10_500);
  });

  it("salary prorates an annual figure over the window", () => {
    expect(salaryPeriodCents(12_000_000, YEAR / 12)).toBe(1_000_000); // $120k/yr -> $10k/mo
    expect(salaryPeriodCents(12_000_000, 0)).toBe(0);
  });

  it("memberPay: hourly multiplies hours, salary ignores them", () => {
    const entries = [{ clockInAt: 0, clockOutAt: 2 * HOUR, rateCentsSnapshot: 3_500 }];
    expect(memberPay(entries, { payType: "hourly", payRateCents: 9_999 }, 0, HOUR)).toEqual({ hours: 2, payCents: 7_000 });
    expect(memberPay(entries, { payType: "salary", payRateCents: 12_000_000 }, 0, YEAR / 12)).toEqual({ hours: 2, payCents: 1_000_000 });
    expect(memberPay(entries, {}, 0, HOUR).payCents).toBe(0); // unpaid
  });
});

describe("self-service clock (as a staff member)", () => {
  it("clocks in, reports active, clocks out, records hours + snapshot rate", async () => {
    const t = convexTest(schema);
    const org = "studio_clock";
    const memberId = await t.run((ctx) =>
      ctx.db.insert("members", { orgId: org, name: "Eng", role: "engineer", skills: [], clerkUserId: "u_eng", payType: "hourly", payRateCents: 4_000 }),
    );
    const shiftId = await t.run((ctx) =>
      ctx.db.insert("shifts", { orgId: org, memberId, startTime: Date.now() - 1_000, endTime: Date.now() + HOUR, kind: "scheduled", status: "scheduled" }),
    );
    const asEng = t.withIdentity({ subject: "u_eng", orgId: org });

    const entryId = await asEng.mutation(api.timeclock.clockIn, { shiftId });
    const again = await asEng.mutation(api.timeclock.clockIn, {}); // idempotent
    expect(again).toBe(entryId);

    const st = await asEng.query(api.timeclock.myStatus, {});
    expect(st.active?._id).toBe(entryId);

    await asEng.mutation(api.timeclock.clockOut, {});
    const after = await asEng.query(api.timeclock.myStatus, {});
    expect(after.active).toBeNull();

    const entry = await t.run((ctx) => ctx.db.get(entryId));
    expect(entry!.status).toBe("completed");
    expect(entry!.clockOutAt!).toBeGreaterThanOrEqual(entry!.clockInAt);
    expect(entry!.rateCentsSnapshot).toBe(4_000);

    // Punches land in the activity log so owners/managers get notified
    // (bell feed + live toasts).
    const acts = await t.run((ctx) => ctx.db.query("activity").collect());
    const kinds = acts.map((a) => a.kind);
    expect(kinds).toContain("staff.clocked_in");
    expect(kinds).toContain("staff.clocked_out");
    const inAct = acts.find((a) => a.kind === "staff.clocked_in")!;
    expect(inAct.summary).toContain("Eng");
    expect(inAct.entityId).toBe(memberId);
  });

  it("a different teammate can't be clocked - only yourself", async () => {
    const t = convexTest(schema);
    const org = "studio_clock2";
    await t.run((ctx) => ctx.db.insert("members", { orgId: org, name: "Eng", role: "engineer", skills: [], clerkUserId: "u_eng" }));
    // No member row for u_stranger in this org -> not a studio member here.
    const stranger = t.withIdentity({ subject: "u_stranger", orgId: org });
    await expect(stranger.mutation(api.timeclock.clockIn, {})).rejects.toThrow();
  });
});

describe("admin payroll", () => {
  it("summarizes hours + pay and posts a labor expense into the P&L", async () => {
    const t = convexTest(schema);
    const org = "studio_pay";
    // Payroll is a Pro-tier capability, so the workspace row has to exist and
    // sit on a plan that includes it. plan "studio" maps to the Pro tier.
    await t.run((ctx) =>
      ctx.db.insert("orgs", { orgId: org, name: "Pay Studio", slug: "pay-studio", plan: "studio" }),
    );
    const eng = await t.run((ctx) =>
      ctx.db.insert("members", { orgId: org, name: "Eng", role: "engineer", skills: [], payType: "hourly", payRateCents: 5_000 }),
    );
    await t.run((ctx) => ctx.db.insert("members", { orgId: org, name: "Owner", role: "owner", skills: [], clerkUserId: "u_own" }));
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("timeEntries", { orgId: org, memberId: eng, clockInAt: now - 4 * HOUR, clockOutAt: now, status: "completed", rateCentsSnapshot: 5_000, source: "self" }),
    );
    const asOwner = t.withIdentity({ subject: "u_own", orgId: org });

    const sum = await asOwner.query(api.payroll.summary, { start: now - 86_400_000, end: now + 86_400_000 });
    const engRow = sum.rows.find((r) => r.name === "Eng")!;
    expect(engRow.hours).toBeCloseTo(4, 5);
    expect(engRow.payCents).toBe(20_000); // 4h x $50
    expect(sum.totalPayCents).toBe(20_000);

    const res = await asOwner.mutation(api.payroll.postToExpenses, { start: now - 86_400_000, end: now + 86_400_000 });
    expect(res.created).toBe(1);
    expect(res.totalCents).toBe(20_000);

    const expenses = await asOwner.query(api.expenses.list, {});
    expect(expenses.some((e) => e.category === "payroll" && e.amountCents === 20_000)).toBe(true);
  });

  it("pay schedule: defaults monthly, owner/manager can set biweekly + anchor, staff can't", async () => {
    const t = convexTest(schema);
    const org = "studio_sched";
    await t.run((ctx) => ctx.db.insert("orgs", { orgId: org, name: "Sched Studio", slug: "sched-studio", plan: "studio" }));
    await t.run((ctx) => ctx.db.insert("members", { orgId: org, name: "Owner", role: "owner", skills: [], clerkUserId: "u_own" }));
    await t.run((ctx) => ctx.db.insert("members", { orgId: org, name: "Eng", role: "engineer", skills: [], clerkUserId: "u_eng" }));
    const asOwner = t.withIdentity({ subject: "u_own", orgId: org });
    const asEng = t.withIdentity({ subject: "u_eng", orgId: org });

    const before = await asOwner.query(api.payroll.getSchedule, {});
    expect(before).toEqual({ schedule: "monthly", anchorDate: null });

    await asOwner.mutation(api.payroll.setSchedule, { schedule: "biweekly", anchorDate: "2026-06-29" });
    const after = await asOwner.query(api.payroll.getSchedule, {});
    expect(after).toEqual({ schedule: "biweekly", anchorDate: "2026-06-29" });

    // Switching back keeps the anchor for a later return to biweekly.
    await asOwner.mutation(api.payroll.setSchedule, { schedule: "monthly" });
    expect(await asOwner.query(api.payroll.getSchedule, {})).toEqual({ schedule: "monthly", anchorDate: "2026-06-29" });

    await expect(asOwner.mutation(api.payroll.setSchedule, { schedule: "biweekly", anchorDate: "June 29" })).rejects.toThrow();
    await expect(asEng.mutation(api.payroll.setSchedule, { schedule: "monthly" })).rejects.toThrow();
  });

  it("setPay updates a teammate's rate", async () => {
    const t = convexTest(schema);
    const org = "studio_pay3";
    const eng = await t.run((ctx) => ctx.db.insert("members", { orgId: org, name: "Eng", role: "engineer", skills: [] }));
    await t.run((ctx) => ctx.db.insert("members", { orgId: org, name: "Owner", role: "owner", skills: [], clerkUserId: "u_own" }));
    const asOwner = t.withIdentity({ subject: "u_own", orgId: org });
    await asOwner.mutation(api.members.setPay, { id: eng, payType: "salary", payRateCents: 12_000_000 });
    const m = await t.run((ctx) => ctx.db.get(eng));
    expect(m!.payType).toBe("salary");
    expect(m!.payRateCents).toBe(12_000_000);
  });
});
