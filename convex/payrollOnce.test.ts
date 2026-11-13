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
    expect(first).toEqual({ created: 1, adjusted: 0, skipped: 0, totalCents: 20_000, blocked: [], overlapping: [], overPosted: [] });
    const second = await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END });
    expect(second).toEqual({ created: 0, adjusted: 0, skipped: 1, totalCents: 0, blocked: [], overlapping: [], overPosted: [] });
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
    const NEXT_END = Date.UTC(2026, 10, 8);
    await t.run((ctx) =>
      ctx.db.insert("timeEntries", {
        orgId, memberId: engId, clockInAt: END + DAY, clockOutAt: END + DAY + 2 * HOUR, status: "completed",
        rateCentsSnapshot: 5_000, source: "self",
      }),
    );
    const res = await as(t, "own").mutation(api.payroll.postToExpenses, { start: END, end: NEXT_END });
    expect(res).toEqual({ created: 1, adjusted: 0, skipped: 0, totalCents: 10_000, blocked: [], overlapping: [], overPosted: [] });
    expect((await payrollRows(t)).map((r) => r.payrollPeriod).sort()).toEqual([
      "2026-10-01_2026-11-01",
      "2026-11-01_2026-11-08",
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
    const PEND = now - HOUR; // a finished period: an unfinished one cannot be posted
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

describe("each hour reaches the ledger once, across overlapping windows (H208-02)", () => {
  const AFTER = Date.UTC(2026, 10, 13, 12); // "now" in these tests: after October ended
  afterEach(() => vi.useRealTimers());
  const at = () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AFTER);
  };

  it("a pay period inside a month already posted is not posted again", async () => {
    at();
    const t = newT();
    const { engId } = await studio(t);
    await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END }); // Last month
    const res = await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: START + 14 * DAY }); // a biweekly period inside it
    expect(res).toMatchObject({ created: 0, adjusted: 0, overlapping: [{ memberId: engId, name: "Eli" }] });
    expect(await payrollRows(t)).toHaveLength(1);
  });

  it("a month over a pay period already posted is not posted again", async () => {
    at();
    const t = newT();
    await studio(t);
    await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: START + 14 * DAY });
    const res = await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END });
    expect(res.overlapping).toHaveLength(1);
    expect(await payrollRows(t)).toHaveLength(1);
  });

  it("a year-to-date window posted on two different days does not repost the year", async () => {
    at();
    const t = newT();
    await studio(t);
    const YEAR = Date.UTC(2026, 0, 1);
    await as(t, "own").mutation(api.payroll.postToExpenses, { start: YEAR, end: AFTER - DAY });
    vi.setSystemTime(AFTER + DAY);
    const res = await as(t, "own").mutation(api.payroll.postToExpenses, { start: YEAR, end: AFTER });
    expect(res).toMatchObject({ created: 0, overlapping: [{ name: "Eli" }] });
    expect(await payrollRows(t)).toHaveLength(1);
  });

  it("a period posted before this fix (key in notes only) blocks an overlapping window too", async () => {
    at();
    const t = newT();
    const { orgId, engId } = await studio(t);
    await t.run((ctx) =>
      ctx.db.insert("expenses", {
        orgId, category: "payroll", vendor: "Eli", description: "Payroll", amountCents: 20_000, date: END - 1,
        memberId: engId, notes: "[payroll 2026-10-01_2026-11-01]",
      }),
    );
    const res = await as(t, "own").mutation(api.payroll.postToExpenses, { start: START + DAY, end: START + 15 * DAY });
    expect(res.overlapping).toHaveLength(1);
    expect(await payrollRows(t)).toHaveLength(1);
  });

  it("a session payout in the ledger (no period) does not block a period", async () => {
    at();
    const t = newT();
    const { orgId, engId } = await studio(t);
    await t.run((ctx) =>
      ctx.db.insert("expenses", {
        orgId, category: "payroll", vendor: "Eli", description: "Session payout", amountCents: 5_000, date: START + 2 * DAY, memberId: engId,
      }),
    );
    const res = await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END });
    expect(res.created).toBe(1);
  });
});

describe("a period is posted only once it is over, and hours added later still land (H208-03)", () => {
  const AFTER = Date.UTC(2026, 10, 13, 12);
  afterEach(() => vi.useRealTimers());
  const at = (ms = AFTER) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ms);
  };

  it("a period that has not ended yet is refused and nothing is written", async () => {
    at();
    const t = newT();
    await studio(t);
    await expect(
      as(t, "own").mutation(api.payroll.postToExpenses, { start: Date.UTC(2026, 10, 1), end: Date.UTC(2026, 11, 1) }),
    ).rejects.toThrow(/hasn't ended/);
    expect(await payrollRows(t)).toHaveLength(0);
  });

  it("a teammate with a clock still open in the period is held back, even under 12 hours", async () => {
    const PEND = Date.UTC(2026, 10, 1);
    at(PEND + 2 * HOUR);
    const t = newT();
    const { orgId, engId } = await studio(t);
    await t.run((ctx) =>
      ctx.db.insert("timeEntries", {
        orgId, memberId: engId, clockInAt: PEND - 3 * HOUR, status: "active", rateCentsSnapshot: 5_000, source: "self",
      }),
    );
    const res = await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: PEND });
    expect(res).toMatchObject({ created: 0, blocked: [{ memberId: engId, name: "Eli" }] });
    expect(await payrollRows(t)).toHaveLength(0);
  });

  it("hours added after a post land as a correction for exactly the difference, once", async () => {
    at();
    const t = newT();
    const { engId } = await studio(t);
    await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END }); // 4h = $200
    await as(t, "own").mutation(api.payroll.addManualEntry, {
      memberId: engId, clockInAt: START + 3 * DAY, clockOutAt: START + 3 * DAY + 3 * HOUR, note: "Missed punch",
    });
    const second = await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END });
    expect(second).toMatchObject({ created: 0, adjusted: 1, totalCents: 15_000 });
    const third = await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END });
    expect(third).toMatchObject({ created: 0, adjusted: 0, skipped: 1, totalCents: 0 });
    const rows = await payrollRows(t);
    expect(rows.map((r) => [r.description, r.amountCents]).sort()).toEqual([["Payroll correction", 15_000], ["Payroll", 20_000]]);
    expect(rows.every((r) => r.payrollPeriod === "2026-10-01_2026-11-01" && r.payrollStart === START && r.payrollEnd === END)).toBe(true);
    // The report on past double posts does not mistake the correction for one.
    const rep = await t.query(internal.payrollCorrections.reportDuplicatePayrollPosts, {
      orgId: "org_p", paginationOpts: { numItems: 100, cursor: null },
    });
    expect(rep.rows).toEqual([]);
  });

  it("an entry removed after a post is reported as over-posted; nothing is taken back by itself", async () => {
    at();
    const t = newT();
    const { engId, entryId } = await studio(t);
    await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END });
    await as(t, "own").mutation(api.payroll.removeEntry, { entryId, reason: "Not worked" });
    const res = await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END });
    expect(res).toMatchObject({ created: 0, adjusted: 0, overPosted: [{ memberId: engId, name: "Eli", overCents: 20_000 }] });
    expect(await payrollRows(t)).toHaveLength(1);
  });

  it("a salaried teammate's period posted twice adds nothing the second time", async () => {
    at();
    const t = newT();
    const { orgId } = await studio(t);
    await t.run((ctx) =>
      ctx.db.insert("members", { orgId, name: "Sal", role: "manager", skills: [], payType: "salary", payRateCents: 3_650_000 } as never),
    );
    const first = await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END });
    expect(first.created).toBe(2);
    const second = await as(t, "own").mutation(api.payroll.postToExpenses, { start: START, end: END });
    expect(second).toMatchObject({ created: 0, adjusted: 0, skipped: 2 });
  });
});

describe("who may correct hours (H208-04)", () => {
  async function withOwnEntries(t: T, orgId = "org_p") {
    return await t.run(async (ctx) => {
      const mia = (await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()).find((m) => m.name === "Mia")!;
      const own = (await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()).find((m) => m.name === "Owner")!;
      await ctx.db.patch(mia._id, { payType: "hourly", payRateCents: 3_000 });
      const miaEntry = await ctx.db.insert("timeEntries", {
        orgId, memberId: mia._id, clockInAt: START + 2 * DAY, clockOutAt: START + 2 * DAY + 2 * HOUR, status: "completed",
        rateCentsSnapshot: 3_000, source: "self",
      });
      const ownEntry = await ctx.db.insert("timeEntries", {
        orgId, memberId: own._id, clockInAt: START + 2 * DAY, clockOutAt: START + 2 * DAY + 2 * HOUR, status: "completed", source: "self",
      });
      return { miaId: mia._id, ownId: own._id, miaEntry, ownEntry };
    });
  }

  it("a manager the owner keeps away from money cannot add, adjust or remove anyone's hours", async () => {
    const t = newT();
    const { orgId, engId, entryId } = await studio(t);
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first())!;
      await ctx.db.patch(org._id, { managersSeeMoney: false });
    });
    const mgr = as(t, "mgr");
    await expect(mgr.mutation(api.payroll.addManualEntry, {
      memberId: engId, clockInAt: START + 5 * DAY, clockOutAt: START + 5 * DAY + HOUR,
    })).rejects.toThrow();
    await expect(mgr.mutation(api.payroll.adjustEntry, { entryId, clockOutAt: START + DAY + 9 * HOUR })).rejects.toThrow();
    await expect(mgr.mutation(api.payroll.removeEntry, { entryId })).rejects.toThrow();
    const e = (await t.run((ctx) => ctx.db.get(entryId)))!;
    expect(e.clockOutAt).toBe(START + DAY + 4 * HOUR);
    expect(e.voidedAt).toBeUndefined();
  });

  it("a manager cannot add to, adjust or remove their own hours", async () => {
    const t = newT();
    await studio(t);
    const { miaId, miaEntry } = await withOwnEntries(t);
    const mgr = as(t, "mgr");
    await expect(mgr.mutation(api.payroll.addManualEntry, {
      memberId: miaId, clockInAt: START + 5 * DAY, clockOutAt: START + 5 * DAY + 10 * HOUR,
    })).rejects.toThrow(/your own hours/);
    await expect(mgr.mutation(api.payroll.adjustEntry, { entryId: miaEntry, clockOutAt: START + 2 * DAY + 9 * HOUR }))
      .rejects.toThrow(/your own hours/);
    await expect(mgr.mutation(api.payroll.removeEntry, { entryId: miaEntry })).rejects.toThrow(/your own hours/);
    const rows = await t.run(async (ctx) => (await ctx.db.query("timeEntries").collect()).filter((e) => e.memberId === miaId));
    expect(rows).toHaveLength(1);
    expect(rows[0].clockOutAt).toBe(START + 2 * DAY + 2 * HOUR);
  });

  it("the owner cannot change their own hours either, but can change a manager's", async () => {
    const t = newT();
    await studio(t);
    const { ownEntry, miaEntry } = await withOwnEntries(t);
    await expect(as(t, "own").mutation(api.payroll.adjustEntry, { entryId: ownEntry, clockOutAt: START + 2 * DAY + 9 * HOUR }))
      .rejects.toThrow(/your own hours/);
    await as(t, "own").mutation(api.payroll.adjustEntry, { entryId: miaEntry, clockOutAt: START + 2 * DAY + 3 * HOUR });
    expect((await t.run((ctx) => ctx.db.get(miaEntry)))!.clockOutAt).toBe(START + 2 * DAY + 3 * HOUR);
  });

  it("the timesheet marks the viewer's own entries and own row, so the page offers no edit on them", async () => {
    const t = newT();
    await studio(t);
    const { miaEntry, miaId } = await withOwnEntries(t);
    const list = await as(t, "mgr").query(api.payroll.listEntries, { start: START, end: END });
    expect(list.find((e) => e._id === miaEntry)?.mine).toBe(true);
    expect(list.filter((e) => e.mine)).toHaveLength(1);
    const sum = await as(t, "mgr").query(api.payroll.summary, { start: START, end: END });
    expect(sum.rows.filter((r) => r.isYou).map((r) => r.memberId)).toEqual([miaId]);
  });
});

describe("a removed entry counts for nothing everywhere (H208-05)", () => {
  it("voiding a running clock also closes it at its own start, so it is zero hours to any client", async () => {
    const t = newT();
    const { orgId, engId } = await studio(t);
    const now = Date.now();
    const openId = await t.run((ctx) =>
      ctx.db.insert("timeEntries", { orgId, memberId: engId, clockInAt: now - HOUR, status: "active", rateCentsSnapshot: 5_000, source: "self" }),
    );
    await as(t, "mgr").mutation(api.payroll.removeEntry, { entryId: openId, reason: "Stray punch" });
    const e = (await t.run((ctx) => ctx.db.get(openId)))!;
    expect(e.status).toBe("completed");
    expect(e.clockOutAt).toBe(e.clockInAt);
  });

  it("voiding a finished entry keeps its recorded times", async () => {
    const t = newT();
    const { entryId } = await studio(t);
    await as(t, "mgr").mutation(api.payroll.removeEntry, { entryId });
    expect((await t.run((ctx) => ctx.db.get(entryId)))!.clockOutAt).toBe(START + DAY + 4 * HOUR);
  });

  it("the teammate's own timesheet leaves removed entries out", async () => {
    const t = newT();
    const { orgId, engId, entryId } = await studio(t);
    const keep = await t.run((ctx) =>
      ctx.db.insert("timeEntries", {
        orgId, memberId: engId, clockInAt: START + 3 * DAY, clockOutAt: START + 3 * DAY + HOUR, status: "completed", source: "self",
      }),
    );
    await as(t, "mgr").mutation(api.payroll.removeEntry, { entryId });
    const mine = await as(t, "eng").query(api.timeclock.myEntries, {});
    expect(mine.map((e) => e._id)).toEqual([keep]);
  });
});

describe("the same hours are never entered twice (H208-06)", () => {
  it("a manual entry over hours already punched is refused", async () => {
    const t = newT();
    const { engId } = await studio(t);
    await expect(as(t, "mgr").mutation(api.payroll.addManualEntry, {
      memberId: engId, clockInAt: START + DAY, clockOutAt: START + DAY + 4 * HOUR,
    })).rejects.toThrow(/overlap/);
    await expect(as(t, "mgr").mutation(api.payroll.addManualEntry, {
      memberId: engId, clockInAt: START + DAY + 3 * HOUR, clockOutAt: START + DAY + 6 * HOUR,
    })).rejects.toThrow(/overlap/);
    const sum = await as(t, "own").query(api.payroll.summary, { start: START, end: END });
    expect(sum.totalPayCents).toBe(20_000);
  });

  it("an entry right after another (touching, not overlapping) is fine", async () => {
    const t = newT();
    const { engId } = await studio(t);
    await as(t, "mgr").mutation(api.payroll.addManualEntry, {
      memberId: engId, clockInAt: START + DAY + 4 * HOUR, clockOutAt: START + DAY + 5 * HOUR,
    });
    const sum = await as(t, "own").query(api.payroll.summary, { start: START, end: END });
    expect(sum.totalPayCents).toBe(25_000);
  });

  it("a manual entry over a clock that is still running is refused", async () => {
    const t = newT();
    const { orgId, engId } = await studio(t);
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("timeEntries", { orgId, memberId: engId, clockInAt: now - 3 * HOUR, status: "active", source: "self" }),
    );
    await expect(as(t, "mgr").mutation(api.payroll.addManualEntry, {
      memberId: engId, clockInAt: now - 2 * HOUR, clockOutAt: now - HOUR,
    })).rejects.toThrow(/overlap/);
  });

  it("moving an entry onto another is refused; a removed entry does not count", async () => {
    const t = newT();
    const { orgId, engId, entryId } = await studio(t);
    const other = await t.run((ctx) =>
      ctx.db.insert("timeEntries", {
        orgId, memberId: engId, clockInAt: START + DAY + 6 * HOUR, clockOutAt: START + DAY + 8 * HOUR, status: "completed", source: "self",
      }),
    );
    await expect(as(t, "mgr").mutation(api.payroll.adjustEntry, { entryId, clockOutAt: START + DAY + 7 * HOUR }))
      .rejects.toThrow(/overlap/);
    expect((await t.run((ctx) => ctx.db.get(entryId)))!.clockOutAt).toBe(START + DAY + 4 * HOUR);
    await as(t, "mgr").mutation(api.payroll.removeEntry, { entryId: other });
    await as(t, "mgr").mutation(api.payroll.adjustEntry, { entryId, clockOutAt: START + DAY + 7 * HOUR });
    expect((await t.run((ctx) => ctx.db.get(entryId)))!.clockOutAt).toBe(START + DAY + 7 * HOUR);
  });

  it("another teammate's hours at the same time are not an overlap", async () => {
    const t = newT();
    const { orgId } = await studio(t);
    const ana = await t.run((ctx) =>
      ctx.db.insert("members", { orgId, name: "Ana", role: "engineer", skills: [], payType: "hourly", payRateCents: 4_000 } as never),
    );
    await as(t, "mgr").mutation(api.payroll.addManualEntry, {
      memberId: ana, clockInAt: START + DAY, clockOutAt: START + DAY + 4 * HOUR,
    });
  });
});

describe("an agency owner with hours in the studio cannot change their own (H208-R2-01, H208-R2-04)", () => {
  async function agencyOwnerWithHours(t: T, orgId = "org_p") {
    return await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId: "ag", name: "AG", slug: "ag", plan: "max", status: "active", ownerClerkUserId: "u_ag", ownerEmail: "o@x.com" } as never);
      await ctx.db.insert("agencyMembers", { agencyId: "ag", clerkUserId: "u_ag", email: "o@x.com", name: "Ada", role: "owner", status: "active", invitedAt: 0 });
      const org = (await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first())!;
      await ctx.db.patch(org._id, { agencyId: "ag" } as never);
      await ctx.db.insert("agencyWorkspaceSelections", { agencyId: "ag", clerkUserId: "u_ag", orgId, updatedAt: 0 });
      const adaId = await ctx.db.insert("members", {
        orgId, name: "Ada", role: "engineer", skills: [], clerkUserId: "u_ag", payType: "hourly", payRateCents: 9_000,
      } as never);
      const adaEntry = await ctx.db.insert("timeEntries", {
        orgId, memberId: adaId, clockInAt: START + 3 * DAY, clockOutAt: START + 3 * DAY + 2 * HOUR, status: "completed",
        rateCentsSnapshot: 9_000, source: "self",
      });
      return { adaId, adaEntry };
    });
  }
  const agency = (t: T) => t.withIdentity({ subject: "u_ag", name: "Ada", orgId: "ag", orgType: "agency" });

  it("refuses adding to, adjusting or removing their own hours, and still lets them fix a teammate's", async () => {
    const t = newT();
    const { entryId } = await studio(t);
    const { adaId, adaEntry } = await agencyOwnerWithHours(t);
    const ada = agency(t);
    await expect(ada.mutation(api.payroll.adjustEntry, { entryId: adaEntry, clockOutAt: START + 3 * DAY + 7 * HOUR }))
      .rejects.toThrow(/your own hours/);
    await expect(ada.mutation(api.payroll.addManualEntry, {
      memberId: adaId, clockInAt: START + 5 * DAY, clockOutAt: START + 5 * DAY + 5 * HOUR,
    })).rejects.toThrow(/your own hours/);
    await expect(ada.mutation(api.payroll.removeEntry, { entryId: adaEntry })).rejects.toThrow(/your own hours/);
    expect((await t.run((ctx) => ctx.db.get(adaEntry)))!.clockOutAt).toBe(START + 3 * DAY + 2 * HOUR);
    await ada.mutation(api.payroll.adjustEntry, { entryId, clockOutAt: START + DAY + 5 * HOUR });
    expect((await t.run((ctx) => ctx.db.get(entryId)))!.clockOutAt).toBe(START + DAY + 5 * HOUR);
  });

  it("marks their own row and entries on the timesheet", async () => {
    const t = newT();
    await studio(t);
    const { adaId, adaEntry } = await agencyOwnerWithHours(t);
    const list = await agency(t).query(api.payroll.listEntries, { start: START, end: END });
    expect(list.filter((e) => e.mine).map((e) => e._id)).toEqual([adaEntry]);
    const sum = await agency(t).query(api.payroll.summary, { start: START, end: END });
    expect(sum.rows.filter((r) => r.isYou).map((r) => r.memberId)).toEqual([adaId]);
  });
});

describe("a correction in a period already posted is not counted twice (H208-R2-02)", () => {
  const W1 = START;
  const W2 = START + 7 * DAY;
  const W3 = START + 14 * DAY;

  async function nightShift(t: T, orgId: string, engId: Awaited<ReturnType<typeof studio>>["engId"]) {
    // Sun 22:00 to Mon 02:00: filed under week 1 by its clock-in.
    return await t.run((ctx) =>
      ctx.db.insert("timeEntries", {
        orgId, memberId: engId, clockInAt: W2 - 2 * HOUR, clockOutAt: W2 + 2 * HOUR, status: "completed",
        rateCentsSnapshot: 5_000, source: "self",
      }),
    );
  }

  it("moving a posted entry's clock-in into the next period is refused, and week 2 posts nothing for it", async () => {
    const t = newT();
    const { orgId, engId } = await studio(t);
    const night = await nightShift(t, orgId, engId);
    await as(t, "own").mutation(api.payroll.postToExpenses, { start: W1, end: W2 });
    await expect(as(t, "mgr").mutation(api.payroll.adjustEntry, { entryId: night, clockInAt: W2 }))
      .rejects.toThrow(/already posted/);
    expect((await t.run((ctx) => ctx.db.get(night)))!.clockInAt).toBe(W2 - 2 * HOUR);
    const wk2 = await as(t, "own").mutation(api.payroll.postToExpenses, { start: W2, end: W3 });
    expect(wk2.totalCents).toBe(0);
  });

  it("a period posted before exact windows were stored (key only) is protected too", async () => {
    const t = newT();
    const { orgId, engId } = await studio(t);
    const night = await nightShift(t, orgId, engId);
    await t.run((ctx) =>
      ctx.db.insert("expenses", {
        orgId, category: "payroll", vendor: "Eli", description: "Payroll", amountCents: 40_000, date: W2 - 1,
        memberId: engId, notes: "[payroll 2026-10-01_2026-10-08]",
      }),
    );
    await expect(as(t, "mgr").mutation(api.payroll.adjustEntry, { entryId: night, clockInAt: W2 + HOUR }))
      .rejects.toThrow(/already posted/);
  });

  it("a change inside a posted period is allowed and tells the panel to post that period again", async () => {
    const t = newT();
    const { orgId, engId, entryId } = await studio(t);
    const night = await nightShift(t, orgId, engId);
    await as(t, "own").mutation(api.payroll.postToExpenses, { start: W1, end: W2 });
    const res = await as(t, "mgr").mutation(api.payroll.adjustEntry, { entryId: night, clockInAt: W2 - 3 * HOUR });
    expect(res).toEqual({ postedPeriod: true });
    const again = await as(t, "own").mutation(api.payroll.postToExpenses, { start: W1, end: W2 });
    expect(again).toMatchObject({ adjusted: 1, totalCents: 5_000 });
    const removed = await as(t, "mgr").mutation(api.payroll.removeEntry, { entryId });
    expect(removed).toEqual({ postedPeriod: true });
    // A second remove does nothing and says the same.
    expect(await as(t, "mgr").mutation(api.payroll.removeEntry, { entryId })).toEqual({ postedPeriod: true });
  });

  it("an entry in a period not yet posted moves freely and reports no posted period", async () => {
    const t = newT();
    const { orgId, engId } = await studio(t);
    const night = await nightShift(t, orgId, engId);
    const res = await as(t, "mgr").mutation(api.payroll.adjustEntry, { entryId: night, clockInAt: W2 });
    expect(res).toEqual({ postedPeriod: false });
    expect(await as(t, "mgr").mutation(api.payroll.removeEntry, { entryId: night })).toEqual({ postedPeriod: false });
  });

  it("another teammate's or another studio's post does not block the move", async () => {
    const t = newT();
    const { orgId, engId } = await studio(t);
    const night = await nightShift(t, orgId, engId);
    const other = await studio(t, "org_q");
    await as(t, "own", "org_q").mutation(api.payroll.postToExpenses, { start: W1, end: W2 });
    expect(other.orgId).toBe("org_q");
    const res = await as(t, "mgr").mutation(api.payroll.adjustEntry, { entryId: night, clockInAt: W2 });
    expect(res).toEqual({ postedPeriod: false });
  });
});

describe("a late clock-in from an offline phone never repeats recorded hours (H208-R2-03)", () => {
  it("a queued clock-in older than a manual entry starts where that entry ends", async () => {
    const t = newT();
    const { orgId, engId } = await studio(t);
    const now = Date.now();
    // The manager covers 9:00-11:00 by hand before the phone's punch arrives.
    await as(t, "mgr").mutation(api.payroll.addManualEntry, {
      memberId: engId, clockInAt: now - 4 * HOUR, clockOutAt: now - 2 * HOUR,
    });
    const id = await as(t, "eng").mutation(api.timeclock.clockIn, { at: now - 4 * HOUR });
    const e = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(e.clockInAt).toBe(now - 2 * HOUR);
    const moved = await t.run(async (ctx) =>
      (await ctx.db.query("activity").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect())
        .filter((a) => a.kind === "staff.clock_in_moved"),
    );
    expect(moved).toHaveLength(1);
    await as(t, "eng").mutation(api.timeclock.clockOut, {});
    const all = await t.run(async (ctx) =>
      (await ctx.db.query("timeEntries").collect()).filter((r) => r.memberId === engId && !r.voidedAt && r.clockInAt > now - DAY),
    );
    // No two entries share any time.
    for (const a of all) for (const b of all) {
      if (a._id === b._id) continue;
      expect(a.clockInAt < b.clockOutAt! && b.clockInAt < a.clockOutAt!).toBe(false);
    }
  });

  it("a queued clock-in before a later manual entry starts after it, so the running clock never covers it", async () => {
    const t = newT();
    const { engId } = await studio(t);
    const now = Date.now();
    await as(t, "mgr").mutation(api.payroll.addManualEntry, {
      memberId: engId, clockInAt: now - 3 * HOUR, clockOutAt: now - 2 * HOUR,
    });
    const id = await as(t, "eng").mutation(api.timeclock.clockIn, { at: now - 5 * HOUR });
    expect((await t.run((ctx) => ctx.db.get(id)))!.clockInAt).toBe(now - 2 * HOUR);
  });

  it("a removed entry does not move the clock-in, and an ordinary clock-in is unchanged", async () => {
    const t = newT();
    const { orgId, engId } = await studio(t);
    const now = Date.now();
    const manual = await as(t, "mgr").mutation(api.payroll.addManualEntry, {
      memberId: engId, clockInAt: now - 4 * HOUR, clockOutAt: now - 2 * HOUR,
    });
    await as(t, "mgr").mutation(api.payroll.removeEntry, { entryId: manual });
    const id = await as(t, "eng").mutation(api.timeclock.clockIn, { at: now - 4 * HOUR });
    expect((await t.run((ctx) => ctx.db.get(id)))!.clockInAt).toBe(now - 4 * HOUR);
    const moved = await t.run(async (ctx) =>
      (await ctx.db.query("activity").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect())
        .filter((a) => a.kind === "staff.clock_in_moved"),
    );
    expect(moved).toHaveLength(0);
  });

  it("a backdated clock-out stops where a later recorded entry begins", async () => {
    const t = newT();
    const { orgId, engId } = await studio(t);
    const now = Date.now();
    const open = await t.run((ctx) =>
      ctx.db.insert("timeEntries", { orgId, memberId: engId, clockInAt: now - 6 * HOUR, status: "active", rateCentsSnapshot: 5_000, source: "self" }),
    );
    // A later entry that reached the record some other way (written directly here).
    await t.run((ctx) =>
      ctx.db.insert("timeEntries", {
        orgId, memberId: engId, clockInAt: now - 3 * HOUR, clockOutAt: now - 2 * HOUR, status: "completed", source: "manual",
      }),
    );
    await as(t, "eng").mutation(api.timeclock.clockOut, { at: now - HOUR });
    expect((await t.run((ctx) => ctx.db.get(open)))!.clockOutAt).toBe(now - 3 * HOUR);
  });
});
