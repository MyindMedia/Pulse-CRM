import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { currentOrgWithCapability } from "./lib/tenant";
import { memberPay, hoursBetween } from "./lib/payroll";

/* ============================================================
   Payroll - the admin side of the time clock. Per-staff hours +
   pay over a period (hours x rate, or prorated salary), manual
   corrections, and a one-click "post to expenses" that drops the
   period's labor cost into the P&L. Reads are insights.read;
   corrections are schedule.manage; posting is invoices.send.
   ============================================================ */

/* Pay-period schedule preference. A studio is paid either monthly (calendar
   months) or biweekly (14-day windows aligned to an anchor date). The stored
   preference is just the choice + anchor; the client computes the concrete
   window boundaries in the viewer's timezone (src/lib/pay-period.ts). */

export const getSchedule = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    return {
      schedule: org?.payrollSchedule ?? ("monthly" as const),
      anchorDate: org?.payrollAnchorDate ?? null,
    };
  },
});

export const setSchedule = mutation({
  args: {
    schedule: v.union(v.literal("monthly"), v.literal("biweekly")),
    // First day of a biweekly period, YYYY-MM-DD. Kept when omitted.
    anchorDate: v.optional(v.string()),
  },
  handler: async (ctx, { schedule, anchorDate }) => {
    const orgId = await currentOrgWithCapability(ctx, "schedule.manage");
    if (anchorDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
      throw new Error("Anchor date must be YYYY-MM-DD.");
    }
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("This studio's workspace isn't set up yet.");
    await ctx.db.patch(org._id, {
      payrollSchedule: schedule,
      ...(anchorDate !== undefined ? { payrollAnchorDate: anchorDate } : {}),
    });
  },
});

/** Per-staff hours + pay for a window, plus totals. */
export const summary = query({
  args: { start: v.number(), end: v.number() },
  handler: async (ctx, { start, end }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const now = Date.now();
    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const entries = await ctx.db
      .query("timeEntries")
      .withIndex("by_org_in", (q) => q.eq("orgId", orgId).gte("clockInAt", start).lt("clockInAt", end))
      .collect();

    const byMember = new Map<string, typeof entries>();
    for (const e of entries) {
      const a = byMember.get(e.memberId) ?? [];
      a.push(e);
      byMember.set(e.memberId, a);
    }

    const rows = members
      .map((m) => {
        const es = byMember.get(m._id) ?? [];
        const { hours, payCents } = memberPay(
          es.map((e) => ({ clockInAt: e.clockInAt, clockOutAt: e.clockOutAt, rateCentsSnapshot: e.rateCentsSnapshot })),
          { payType: m.payType, payRateCents: m.payRateCents },
          now,
          end - start,
        );
        return {
          memberId: m._id,
          name: m.name,
          role: m.role,
          payType: m.payType ?? null,
          payRateCents: m.payRateCents ?? null,
          hours,
          payCents,
          entryCount: es.length,
          openCount: es.filter((e) => !e.clockOutAt).length,
        };
      })
      .filter((r) => r.entryCount > 0 || r.payType)
      .sort((a, b) => b.payCents - a.payCents);

    return {
      rows,
      totalPayCents: rows.reduce((s, r) => s + r.payCents, 0),
      totalHours: rows.reduce((s, r) => s + r.hours, 0),
    };
  },
});

/** Raw time entries in a window (newest first), hydrated with member name +
 *  computed hours, for the admin timesheet / corrections view. */
export const listEntries = query({
  args: { start: v.number(), end: v.number(), memberId: v.optional(v.id("members")) },
  handler: async (ctx, { start, end, memberId }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const now = Date.now();
    let rows = await ctx.db
      .query("timeEntries")
      .withIndex("by_org_in", (q) => q.eq("orgId", orgId).gte("clockInAt", start).lt("clockInAt", end))
      .collect();
    if (memberId) rows = rows.filter((r) => r.memberId === memberId);
    rows.sort((a, b) => b.clockInAt - a.clockInAt);
    return await Promise.all(
      rows.map(async (r) => {
        const m = await ctx.db.get(r.memberId);
        return {
          ...r,
          memberName: m?.name ?? "Unknown",
          hours: hoursBetween(r.clockInAt, r.clockOutAt ?? now),
        };
      }),
    );
  },
});

/** Manually add a completed entry (e.g. someone forgot to clock in). */
export const addManualEntry = mutation({
  args: {
    memberId: v.id("members"),
    clockInAt: v.number(),
    clockOutAt: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { memberId, clockInAt, clockOutAt, note }) => {
    const orgId = await currentOrgWithCapability(ctx, "schedule.manage");
    const member = await ctx.db.get(memberId);
    if (!member || member.orgId !== orgId) throw new Error("That team member isn't in this studio.");
    if (clockOutAt <= clockInAt) throw new Error("Clock-out must be after clock-in.");
    return await ctx.db.insert("timeEntries", {
      orgId,
      memberId,
      clockInAt,
      clockOutAt,
      status: "completed",
      rateCentsSnapshot: member.payType === "hourly" ? member.payRateCents : undefined,
      source: "manual",
      note,
    });
  },
});

/** Correct an entry's in/out times or note (admin). */
export const adjustEntry = mutation({
  args: {
    entryId: v.id("timeEntries"),
    clockInAt: v.optional(v.number()),
    clockOutAt: v.optional(v.union(v.number(), v.null())),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { entryId, clockInAt, clockOutAt, note }) => {
    const orgId = await currentOrgWithCapability(ctx, "schedule.manage");
    const entry = await ctx.db.get(entryId);
    if (!entry || entry.orgId !== orgId) throw new Error("Time entry not found.");
    const fields: Record<string, unknown> = {};
    if (clockInAt !== undefined) fields.clockInAt = clockInAt;
    if (clockOutAt !== undefined) {
      fields.clockOutAt = clockOutAt === null ? undefined : clockOutAt;
      fields.status = clockOutAt === null ? "active" : "completed";
    }
    if (note !== undefined) fields.note = note;
    const inAt = (fields.clockInAt as number) ?? entry.clockInAt;
    const outAt = (fields.clockOutAt as number | undefined) ?? entry.clockOutAt;
    if (outAt !== undefined && outAt <= inAt) throw new Error("Clock-out must be after clock-in.");
    await ctx.db.patch(entryId, fields);
  },
});

export const removeEntry = mutation({
  args: { entryId: v.id("timeEntries") },
  handler: async (ctx, { entryId }) => {
    const orgId = await currentOrgWithCapability(ctx, "schedule.manage");
    const entry = await ctx.db.get(entryId);
    if (!entry || entry.orgId !== orgId) throw new Error("Time entry not found.");
    await ctx.db.delete(entryId);
  },
});

/**
 * Post the window's computed labor cost into the Expenses ledger (one "payroll"
 * expense per paid teammate), so it flows into the P&L. Returns how many rows
 * were created + the total.
 */
export const postToExpenses = mutation({
  args: { start: v.number(), end: v.number() },
  handler: async (ctx, { start, end }) => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.send");
    const now = Date.now();
    const members = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const entries = await ctx.db
      .query("timeEntries")
      .withIndex("by_org_in", (q) => q.eq("orgId", orgId).gte("clockInAt", start).lt("clockInAt", end))
      .collect();
    const byMember = new Map<string, typeof entries>();
    for (const e of entries) {
      const a = byMember.get(e.memberId) ?? [];
      a.push(e);
      byMember.set(e.memberId, a);
    }
    const periodTag = `[payroll ${new Date(start).toISOString().slice(0, 10)}_${new Date(end).toISOString().slice(0, 10)}]`;
    let created = 0;
    let totalCents = 0;
    for (const m of members) {
      const es = byMember.get(m._id) ?? [];
      if (!m.payType && es.length === 0) continue;
      const { payCents } = memberPay(
        es.map((e) => ({ clockInAt: e.clockInAt, clockOutAt: e.clockOutAt, rateCentsSnapshot: e.rateCentsSnapshot })),
        { payType: m.payType, payRateCents: m.payRateCents },
        now,
        end - start,
      );
      if (payCents <= 0) continue;
      await ctx.db.insert("expenses", {
        orgId,
        category: "payroll",
        vendor: m.name,
        description: "Payroll",
        amountCents: payCents,
        date: end - 1,
        memberId: m._id,
        notes: periodTag,
      });
      created += 1;
      totalCents += payCents;
    }
    return { created, totalCents };
  },
});
