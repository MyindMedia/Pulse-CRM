import { describe, it, expect, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

/* truth-payroll-double-count: posting a period twice doubled its labour
   cost, hourly engineers were paid again through session payouts, and a
   forgotten clock-out kept adding paid hours with no way to fix it on web. */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 9, 1);
const END = Date.UTC(2026, 10, 1);

const newT = () => convexTest(schema);
type T = ReturnType<typeof newT>;

afterEach(() => vi.unstubAllEnvs());
/** Clerk on, as in staging and production, so a signed-out caller is not the demo owner. */
const clerkOn = () => vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://clerk.pulse.example");

async function studio(t: T, orgId = "org_p") {
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId, name: `Studio ${orgId}`, slug: orgId, tier: "growth" } as never);
    await ctx.db.insert("members", { orgId, name: "Owner", role: "owner", skills: [], clerkUserId: `u_own_${orgId}` } as never);
    await ctx.db.insert("members", { orgId, name: "Mia", role: "manager", skills: [], clerkUserId: `u_mgr_${orgId}` } as never);
    const engId = await ctx.db.insert("members", {
      orgId, name: "Eli", role: "engineer", skills: [], clerkUserId: `u_eng_${orgId}`, payType: "hourly", payRateCents: 5_000,
    } as never);
    const entryId = await ctx.db.insert("timeEntries", {
      orgId, memberId: engId, clockInAt: START + DAY, clockOutAt: START + DAY + 4 * HOUR, status: "completed",
      rateCentsSnapshot: 5_000, source: "self",
    });
    return { orgId, engId, entryId };
  });
}

const as = (t: T, who: "own" | "mgr" | "eng", orgId = "org_p") =>
  t.withIdentity({ subject: `u_${who}_${orgId}`, orgId, name: who === "own" ? "Owner" : who === "mgr" ? "Mia" : "Eli" });

async function payrollRows(t: T, orgId = "org_p") {
  return await t.run(async (ctx) =>
    (await ctx.db.query("expenses").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect())
      .filter((x) => x.category === "payroll"),
  );
}

describe("posting a pay period once", () => {
  it("U-01 posting the same period twice creates no second expense and says it skipped", async () => {
    const t = newT();
    await studio(t);
    const first = await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END });
    expect(first).toEqual({ created: 1, skipped: 0, totalCents: 20_000 });
    const second = await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END });
    expect(second).toEqual({ created: 0, skipped: 1, totalCents: 0 });
    const rows = await payrollRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].payrollPeriod).toBe("2026-10-01_2026-11-01");
    expect(rows[0].notes).toBe("[payroll 2026-10-01_2026-11-01]");
  });

  it("U-01b two posts sent at the same moment (double click, web + phone) still make one", async () => {
    const t = newT();
    await studio(t);
    const res = await Promise.all([
      as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END }),
      as(t, "mgr").mutation(api.payroll.postToExpenses, { start: START, end: END }),
    ]);
    expect(res.map((r) => r.created).sort()).toEqual([0, 1]);
    expect(await payrollRows(t)).toHaveLength(1);
  });

  it("U-01c a period posted before this fix (tag in notes only) is not posted again", async () => {
    const t = newT();
    const { orgId, engId } = await studio(t);
    await t.run((ctx) =>
      ctx.db.insert("expenses", {
        orgId, category: "payroll", vendor: "Eli", description: "Payroll", amountCents: 20_000, date: END - 1,
        memberId: engId, notes: "[payroll 2026-10-01_2026-11-01]",
      }),
    );
    const res = await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END });
    expect(res).toMatchObject({ created: 0, skipped: 1 });
    expect(await payrollRows(t)).toHaveLength(1);
  });

  it("U-03 a different period still posts", async () => {
    const t = newT();
    const { orgId, engId } = await studio(t);
    await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END });
    const NEXT_END = Date.UTC(2026, 11, 1);
    await t.run((ctx) =>
      ctx.db.insert("timeEntries", {
        orgId, memberId: engId, clockInAt: END + DAY, clockOutAt: END + DAY + 2 * HOUR, status: "completed",
        rateCentsSnapshot: 5_000, source: "self",
      }),
    );
    const res = await as(t, "own").mutation(api.payroll.postToExpenses, { start: END, end: NEXT_END });
    expect(res).toEqual({ created: 1, skipped: 0, totalCents: 10_000 });
    expect((await payrollRows(t)).map((r) => r.payrollPeriod).sort()).toEqual([
      "2026-10-01_2026-11-01",
      "2026-11-01_2026-12-01",
    ]);
  });

  it("another studio's post for the same dates does not block this one", async () => {
    const t = newT();
    await studio(t);
    await studio(t, "org_q");
    await as(t, "own", "org_q").mutation(api.payroll.postToExpenses, { start: START, end: END });
    const res = await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END });
    expect(res.created).toBe(1);
    expect(await payrollRows(t)).toHaveLength(1);
    expect(await payrollRows(t, "org_q")).toHaveLength(1);
  });

  it("an engineer, or someone signed out, cannot post", async () => {
    const t = newT();
    await studio(t);
    await expect(as(t, "eng").mutation(api.payroll.postToExpenses, { start: START, end: END })).rejects.toThrow();
    clerkOn();
    await expect(t.mutation(api.payroll.postToExpenses, { start: START, end: END })).rejects.toThrow();
    expect(await payrollRows(t)).toHaveLength(0);
  });

  it("an empty or backwards period is refused", async () => {
    const t = newT();
    await studio(t);
    await expect(as(t, "own").mutation(api.payroll.postToExpenses, { start: END, end: START })).rejects.toThrow(/end after/);
  });
});

describe("report-only checks for past payroll (no writes)", () => {
  it("lists a period posted twice, keeps the first, and changes nothing", async () => {
    const t = newT();
    const { orgId, engId } = await studio(t);
    const ids = await t.run(async (ctx) => {
      const row = { orgId, category: "payroll" as const, vendor: "Eli", description: "Payroll", amountCents: 20_000,
        date: END - 1, memberId: engId, notes: "[payroll 2026-10-01_2026-11-01]" };
      const a = await ctx.db.insert("expenses", row);
      const b = await ctx.db.insert("expenses", row);
      return { a, b };
    });
    const res = await t.query(internal.payrollCorrections.reportDuplicatePayrollPosts, {
      orgId, paginationOpts: { numItems: 100, cursor: null },
    });
    expect(res.rows).toEqual([
      { expenseId: ids.b, keptExpenseId: ids.a, memberName: "Eli", period: "2026-10-01_2026-11-01", amountCents: 20_000 },
    ]);
    expect(await payrollRows(t)).toHaveLength(2);
  });

  it("lists hourly payouts still queued, approved or paid, and voids none of them", async () => {
    const t = newT();
    const { orgId, engId } = await studio(t);
    await t.run(async (ctx) => {
      for (const status of ["queued", "approved", "paid", "void"] as const) {
        await ctx.db.insert("payouts", {
          orgId, memberId: engId, basis: "hourly", amountCents: 14_000, explanation: "3.5 hours at $40.00/hr",
          status, sessionRateCents: 50_000, hoursSnapshot: 3.5, createdAt: START,
        } as never);
      }
    });
    const res = await t.query(internal.payrollCorrections.reportHourlyPayouts, {
      orgId, paginationOpts: { numItems: 100, cursor: null },
    });
    expect(res.rows.map((r) => r.status).sort()).toEqual(["approved", "paid", "queued"]);
    const statuses = await t.run(async (ctx) => (await ctx.db.query("payouts").collect()).map((p) => p.status).sort());
    expect(statuses).toEqual(["approved", "paid", "queued", "void"]);
  });
});
