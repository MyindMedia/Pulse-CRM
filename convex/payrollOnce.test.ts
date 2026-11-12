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
    expect(first).toEqual({ created: 1, skipped: 0, totalCents: 20_000, blocked: [] });
    const second = await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END });
    expect(second).toEqual({ created: 0, skipped: 1, totalCents: 0, blocked: [] });
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
    expect(res).toEqual({ created: 1, skipped: 0, totalCents: 10_000, blocked: [] });
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

describe("timesheet corrections", () => {
  it("U-07 an open entry older than 12h is flagged, left out of pay, and holds back that teammate's post", async () => {
    const t = newT();
    const { orgId, engId } = await studio(t);
    const now = Date.now();
    const PSTART = now - 10 * DAY;
    const PEND = now + DAY;
    const staleId = await t.run(async (ctx) => {
      await ctx.db.insert("timeEntries", {
        orgId, memberId: engId, clockInAt: now - 5 * DAY, clockOutAt: now - 5 * DAY + 3 * HOUR, status: "completed",
        rateCentsSnapshot: 5_000, source: "self",
      });
      return await ctx.db.insert("timeEntries", {
        orgId, memberId: engId, clockInAt: now - 30 * HOUR, status: "active", rateCentsSnapshot: 5_000, source: "self",
      });
    });
    const sum = await as(t, "own").query(api.payroll.summary, { start: PSTART, end: PEND });
    const eli = sum.rows.find((r) => r.name === "Eli")!;
    expect(eli.needsClockOutCount).toBe(1);
    expect(sum.needsClockOutCount).toBe(1);
    expect(eli.hours).toBeCloseTo(3, 5); // the forgotten 30h are not counted
    expect(eli.payCents).toBe(15_000);
    const list = await as(t, "own").query(api.payroll.listEntries, { start: PSTART, end: PEND });
    expect(list.find((e) => e._id === staleId)?.needsClockOut).toBe(true);

    const blocked = await as(t, "own").mutation(api.payroll.postToExpenses, { start: PSTART, end: PEND });
    expect(blocked).toMatchObject({ created: 0, blocked: [{ memberId: engId, name: "Eli" }] });
    expect(await payrollRows(t)).toHaveLength(0);

    // The manager sets the clock-out; now the period posts, once.
    await as(t, "mgr").mutation(api.payroll.adjustEntry, { entryId: staleId, clockOutAt: now - 22 * HOUR });
    const posted = await as(t, "own").mutation(api.payroll.postToExpenses, { start: PSTART, end: PEND });
    expect(posted).toMatchObject({ created: 1, totalCents: 15_000 + 40_000, blocked: [] });
  });

  it("an open entry under 12h old is still counted (someone working now)", async () => {
    const t = newT();
    const { orgId, engId } = await studio(t);
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("timeEntries", { orgId, memberId: engId, clockInAt: now - 2 * HOUR, status: "active", rateCentsSnapshot: 5_000, source: "self" }),
    );
    const sum = await as(t, "own").query(api.payroll.summary, { start: now - DAY, end: now + DAY });
    const eli = sum.rows.find((r) => r.name === "Eli")!;
    expect(eli.needsClockOutCount).toBe(0);
    expect(eli.openCount).toBe(1);
    expect(eli.hours).toBeCloseTo(2, 2);
  });

  it("U-08 a manager fixes a clock-out time and the change is logged with before and after", async () => {
    const t = newT();
    const { entryId } = await studio(t);
    await as(t, "mgr").mutation(api.payroll.adjustEntry, { entryId, clockOutAt: START + DAY + 5 * HOUR });
    const e = await t.run((ctx) => ctx.db.get(entryId));
    expect(e!.clockOutAt).toBe(START + DAY + 5 * HOUR);
    expect(e!.editedBy).toBe("u_mgr_org_p");
    const acts = await t.run(async (ctx) => (await ctx.db.query("activity").collect()).filter((a) => a.kind === "timesheet.adjusted"));
    expect(acts).toHaveLength(1);
    expect(acts[0].actorName).toBe("Mia");
    expect(acts[0].entityId).toBe(entryId);
    expect(acts[0].summary).toContain("Eli's time entry");
    expect(acts[0].summary).toMatch(/out .+ -> .+/);
    // The built-in change log has the before and after values as well.
    const audit = await t.run(async (ctx) =>
      (await ctx.db.query("changeAudit").collect()).filter((a) => a.tableName === "timeEntries" && a.op === "update"),
    );
    expect(audit.at(-1)?.before).toMatchObject({ clockOutAt: START + DAY + 4 * HOUR });
    expect(audit.at(-1)?.after).toMatchObject({ clockOutAt: START + DAY + 5 * HOUR });
  });

  it("U-08b a clock-out in the future or before clock-in is refused, and nothing is logged", async () => {
    const t = newT();
    const { entryId } = await studio(t);
    await expect(as(t, "mgr").mutation(api.payroll.adjustEntry, { entryId, clockOutAt: Date.now() + DAY })).rejects.toThrow(/future/);
    await expect(as(t, "mgr").mutation(api.payroll.adjustEntry, { entryId, clockOutAt: START })).rejects.toThrow(/after clock-in/);
    const acts = await t.run(async (ctx) => (await ctx.db.query("activity").collect()).filter((a) => a.kind.startsWith("timesheet.")));
    expect(acts).toHaveLength(0);
  });

  it("U-09 an engineer cannot add, adjust or remove entries, their own or anyone's", async () => {
    const t = newT();
    const { engId, entryId } = await studio(t);
    const eng = as(t, "eng");
    await expect(eng.mutation(api.payroll.adjustEntry, { entryId, clockOutAt: START + DAY + 9 * HOUR })).rejects.toThrow();
    await expect(eng.mutation(api.payroll.removeEntry, { entryId })).rejects.toThrow();
    await expect(eng.mutation(api.payroll.addManualEntry, {
      memberId: engId, clockInAt: START + 2 * DAY, clockOutAt: START + 2 * DAY + 8 * HOUR,
    })).rejects.toThrow();
    await expect(eng.query(api.payroll.listEntries, { start: START, end: END })).rejects.toThrow();
    const e = await t.run((ctx) => ctx.db.get(entryId));
    expect(e!.clockOutAt).toBe(START + DAY + 4 * HOUR);
    expect(e!.voidedAt).toBeUndefined();
  });

  it("U-10 a signed-out caller cannot read or change entries", async () => {
    const t = newT();
    const { entryId } = await studio(t);
    clerkOn();
    await expect(t.query(api.payroll.listEntries, { start: START, end: END })).rejects.toThrow();
    await expect(t.query(api.payroll.summary, { start: START, end: END })).rejects.toThrow();
    await expect(t.mutation(api.payroll.adjustEntry, { entryId, clockOutAt: START + DAY + 9 * HOUR })).rejects.toThrow();
    await expect(t.mutation(api.payroll.removeEntry, { entryId })).rejects.toThrow();
    expect((await t.run((ctx) => ctx.db.get(entryId)))!.clockOutAt).toBe(START + DAY + 4 * HOUR);
  });

  it("U-11 another studio's entry id is refused", async () => {
    const t = newT();
    const { entryId, engId } = await studio(t);
    await studio(t, "org_q");
    const otherMgr = as(t, "mgr", "org_q");
    await expect(otherMgr.mutation(api.payroll.adjustEntry, { entryId, clockOutAt: START + DAY + 9 * HOUR }))
      .rejects.toThrow("Time entry not found.");
    await expect(otherMgr.mutation(api.payroll.removeEntry, { entryId })).rejects.toThrow("Time entry not found.");
    await expect(otherMgr.mutation(api.payroll.addManualEntry, {
      memberId: engId, clockInAt: START + 2 * DAY, clockOutAt: START + 2 * DAY + HOUR,
    })).rejects.toThrow("isn't in this studio");
    const list = await as(t, "own", "org_q").query(api.payroll.listEntries, { start: START, end: END });
    expect(list.some((e) => e._id === entryId)).toBe(false);
  });

  it("U-12 removing an entry voids it: kept on record, logged, out of pay, and a second remove does nothing", async () => {
    const t = newT();
    const { entryId } = await studio(t);
    await as(t, "mgr").mutation(api.payroll.removeEntry, { entryId, reason: "Punched in by mistake" });
    await as(t, "mgr").mutation(api.payroll.removeEntry, { entryId, reason: "again" });
    const e = (await t.run((ctx) => ctx.db.get(entryId)))!;
    expect(e).toBeTruthy(); // not deleted
    expect(e.voidedAt).toBeTypeOf("number");
    expect(e.voidedBy).toBe("u_mgr_org_p");
    expect(e.voidReason).toBe("Punched in by mistake");
    expect(e.clockInAt).toBe(START + DAY);
    expect(e.clockOutAt).toBe(START + DAY + 4 * HOUR);
    const acts = await t.run(async (ctx) => (await ctx.db.query("activity").collect()).filter((a) => a.kind === "timesheet.voided"));
    expect(acts).toHaveLength(1);
    expect(acts[0].summary).toContain("Punched in by mistake");
    const sum = await as(t, "own").query(api.payroll.summary, { start: START, end: END });
    expect(sum.totalPayCents).toBe(0);
    const list = await as(t, "own").query(api.payroll.listEntries, { start: START, end: END });
    expect(list.find((x) => x._id === entryId)).toMatchObject({ voided: true, hours: 0 });
    await expect(as(t, "mgr").mutation(api.payroll.adjustEntry, { entryId, clockOutAt: START + DAY + HOUR })).rejects.toThrow(/removed/);
    expect((await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END })).created).toBe(0);
  });

  it("U-12b voiding a running clock stops it, so the teammate can clock in again", async () => {
    const t = newT();
    const { orgId, engId } = await studio(t);
    const now = Date.now();
    const openId = await t.run((ctx) =>
      ctx.db.insert("timeEntries", { orgId, memberId: engId, clockInAt: now - HOUR, status: "active", rateCentsSnapshot: 5_000, source: "self" }),
    );
    await as(t, "mgr").mutation(api.payroll.removeEntry, { entryId: openId });
    expect((await t.run((ctx) => ctx.db.get(openId)))!.status).toBe("completed");
    const st = await as(t, "eng").query(api.timeclock.myStatus, {});
    expect(st.active).toBeNull();
    const newId = await as(t, "eng").mutation(api.timeclock.clockIn, {});
    expect(newId).not.toBe(openId);
  });

  it("a manager adds a missed entry; it is logged and paid", async () => {
    const t = newT();
    const { engId } = await studio(t);
    const id = await as(t, "mgr").mutation(api.payroll.addManualEntry, {
      memberId: engId, clockInAt: START + 2 * DAY, clockOutAt: START + 2 * DAY + 2 * HOUR, note: "Forgot to punch",
    });
    const acts = await t.run(async (ctx) => (await ctx.db.query("activity").collect()).filter((a) => a.kind === "timesheet.added"));
    expect(acts[0]).toMatchObject({ entityId: id, actorName: "Mia" });
    const sum = await as(t, "own").query(api.payroll.summary, { start: START, end: END });
    expect(sum.totalPayCents).toBe(30_000);
  });

  it("re-opening an entry is refused while the teammate already has a clock running", async () => {
    const t = newT();
    const { orgId, engId, entryId } = await studio(t);
    await t.run((ctx) =>
      ctx.db.insert("timeEntries", { orgId, memberId: engId, clockInAt: Date.now() - HOUR, status: "active", source: "self" }),
    );
    await expect(as(t, "mgr").mutation(api.payroll.adjustEntry, { entryId, clockOutAt: null })).rejects.toThrow(/open clock/);
  });
});
