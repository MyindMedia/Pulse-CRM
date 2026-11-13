import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internTimeoutClockOut } from "./smsFlows";

/* ============================================================
   Report-only checks for past wage records. Nothing here writes.

   Each function lists the rows a one-time correction would touch and what
   it would change, so the studio (or the owner, on its behalf) can review
   them by hand. They are internal: run them from the Convex dashboard or
   `npx convex run`, one studio and one page at a time.
   ============================================================ */

const HOUR = 3_600_000;
const INTERN_AFTER = 4 * HOUR;

/**
 * Intern entries closed by the old timeout, which cut them at clock-in + 4h
 * even though the intern had been told to stay clocked in while a manager
 * reviewed. For each, the clock-out the current rule would have used (end of
 * the approval window) and the time that was left unpaid.
 */
export const reportPastInternTimeouts = internalQuery({
  args: { orgId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { orgId, paginationOpts }) => {
    const page = await ctx.db
      .query("timeEntries")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "completed"))
      .paginate(paginationOpts);
    const rows = [];
    for (const e of page.page) {
      if (e.voidedAt) continue;
      if (e.autoClosedReason !== "intern_timeout" || e.clockOutAt !== e.clockInAt + INTERN_AFTER) continue;
      const prompts = await ctx.db
        .query("smsPrompts")
        .withIndex("by_entry", (q) => q.eq("entryId", e._id))
        .collect();
      // The sweep that closed it ran at or after the last prompt expired, so
      // that expiry (not "now") bounds the proposed clock-out.
      const lastExpiry = prompts.length > 0 ? Math.max(...prompts.map((p) => p.expiresAt)) : e.clockOutAt;
      const proposedClockOutAt = internTimeoutClockOut(e.clockInAt, prompts.map((p) => p.expiresAt), lastExpiry);
      const member = await ctx.db.get(e.memberId);
      const unpaidMs = proposedClockOutAt - e.clockOutAt;
      if (unpaidMs <= 0) continue;
      const rate = e.rateCentsSnapshot ?? (member?.payType === "hourly" ? member.payRateCents : undefined);
      rows.push({
        entryId: e._id,
        memberId: e.memberId,
        memberName: member?.name ?? "Unknown",
        clockInAt: e.clockInAt,
        recordedClockOutAt: e.clockOutAt,
        proposedClockOutAt,
        unpaidMinutes: Math.round(unpaidMs / 60_000),
        unpaidCents: rate ? Math.round((unpaidMs / HOUR) * rate) : null,
        prompts: prompts.map((p) => ({ kind: p.kind, status: p.status, sentAt: p.sentAt, expiresAt: p.expiresAt })),
      });
    }
    return { rows, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/**
 * Session payouts on the hourly basis, which Pulse no longer creates. Payroll
 * already pays every clocked hour, so a queued or approved one would pay those
 * hours a second time, and a paid one overlaps whatever payroll period covered
 * the session. Listed for the studio to void or reconcile by hand (decision:
 * void with a note); nothing is voided here.
 */
export const reportHourlyPayouts = internalQuery({
  args: { orgId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { orgId, paginationOpts }) => {
    const page = await ctx.db
      .query("payouts")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .paginate(paginationOpts);
    const rows = [];
    for (const p of page.page) {
      if (p.basis !== "hourly" || p.status === "void") continue;
      const member = await ctx.db.get(p.memberId);
      rows.push({
        payoutId: p._id,
        memberName: member?.name ?? "Unknown",
        sessionId: p.sessionId ?? null,
        status: p.status,
        amountCents: p.amountCents,
        hours: p.hoursSnapshot ?? null,
        suggestion:
          p.status === "paid"
            ? "Already paid: find the payroll period that covers this session and void one of the two by hand."
            : "Void this payout with a note: payroll pays these hours.",
      });
    }
    return { rows, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/**
 * Payroll expenses that look posted twice: same teammate, same period (the
 * old postToExpenses never checked). The first post in each group is kept;
 * every later one is listed as a candidate to delete by hand. Pages through
 * the studio's payroll rows; duplicates are found within the teammate's own
 * payroll rows, so a pair is never split across pages.
 */
export const reportDuplicatePayrollPosts = internalQuery({
  args: { orgId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { orgId, paginationOpts }) => {
    const page = await ctx.db
      .query("expenses")
      .withIndex("by_org_category_date", (q) => q.eq("orgId", orgId).eq("category", "payroll"))
      .paginate(paginationOpts);
    const rows = [];
    for (const x of page.page) {
      if (!x.memberId) continue;
      // Posted by the current postToExpenses, which records its window and
      // only ever adds the difference (a "Payroll correction"), never a repeat.
      if (x.payrollStart !== undefined) continue;
      const period = x.payrollPeriod ?? x.notes?.match(/^\[payroll (.+)\]$/)?.[1];
      if (!period) continue;
      // Same teammate, same last day of the period: a small, indexed set.
      const twins = (
        await ctx.db
          .query("expenses")
          .withIndex("by_org_category_date", (q) => q.eq("orgId", orgId).eq("category", "payroll").eq("date", x.date))
          .collect()
      ).filter(
        (y) => y.payrollStart === undefined && y.memberId === x.memberId && (y.payrollPeriod ?? y.notes?.match(/^\[payroll (.+)\]$/)?.[1]) === period,
      );
      if (twins.length < 2) continue;
      twins.sort((a, b) => a._creationTime - b._creationTime);
      if (twins[0]._id === x._id) continue; // the first post stays
      const member = await ctx.db.get(x.memberId);
      rows.push({
        expenseId: x._id,
        keptExpenseId: twins[0]._id,
        memberName: member?.name ?? x.vendor ?? "Unknown",
        period,
        amountCents: x.amountCents,
      });
    }
    return { rows, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});
