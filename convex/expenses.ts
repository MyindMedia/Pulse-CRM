import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { currentOrgWithCapability } from "./lib/tenant";
import { plSummary, monthlyRunRateCents } from "./lib/pnl";

/* ============================================================
   Expenses - the money-OUT half of the books. Manual entry of
   rent, utilities, subscriptions, gear, repairs, contractor /
   engineer payouts, etc., plus a P&L roll-up (collected revenue
   minus expenses) so a studio finally sees true profit.

   Capability gates mirror the rest of finance: writes need
   invoices.send (owner/manager/accountant), reads need
   insights.read (the finance/analytics tier).
   ============================================================ */

const categoryV = v.union(
  v.literal("rent"),
  v.literal("utilities"),
  v.literal("software"),
  v.literal("gear"),
  v.literal("repairs"),
  v.literal("payroll"),
  v.literal("contractor"),
  v.literal("marketing"),
  v.literal("supplies"),
  v.literal("insurance"),
  v.literal("travel"),
  v.literal("fees"),
  v.literal("other"),
);
const recurringV = v.union(v.literal("monthly"), v.literal("annual"));

export const create = mutation({
  args: {
    category: categoryV,
    amountCents: v.number(),
    date: v.number(),
    vendor: v.optional(v.string()),
    description: v.optional(v.string()),
    recurring: v.optional(recurringV),
    memberId: v.optional(v.id("members")),
    receiptId: v.optional(v.id("_storage")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.send");
    if (args.amountCents <= 0) throw new Error("Amount must be greater than zero.");
    if (args.memberId) {
      const m = await ctx.db.get(args.memberId);
      if (!m || m.orgId !== orgId) throw new Error("That team member isn't in this studio.");
    }
    const id = await ctx.db.insert("expenses", { orgId, ...args });
    await ctx.db.insert("activity", {
      orgId,
      kind: "expense.logged",
      summary: `Logged a ${args.category} expense of $${(args.amountCents / 100).toFixed(2)}${args.vendor ? ` to ${args.vendor}` : ""}`,
      entityType: "expense",
      entityId: id,
      accent: "info",
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("expenses"),
    category: v.optional(categoryV),
    amountCents: v.optional(v.number()),
    date: v.optional(v.number()),
    vendor: v.optional(v.string()),
    description: v.optional(v.string()),
    recurring: v.optional(v.union(recurringV, v.null())),
    memberId: v.optional(v.union(v.id("members"), v.null())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.send");
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new Error("Expense not found.");
    if (patch.amountCents !== undefined && patch.amountCents <= 0) {
      throw new Error("Amount must be greater than zero.");
    }
    // Allow clearing recurring / memberId by passing null.
    const fields: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(patch)) {
      if (val === undefined) continue;
      fields[k] = val === null ? undefined : val;
    }
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("expenses") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.send");
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new Error("Expense not found.");
    await ctx.db.delete(id);
  },
});

/** Upload URL for a receipt image/PDF attached to an expense. */
export const generateReceiptUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await currentOrgWithCapability(ctx, "invoices.send");
    return await ctx.storage.generateUploadUrl();
  },
});

/** Expense rows in a date range (newest first), hydrated with member name +
 *  receipt URL. */
export const list = query({
  args: {
    start: v.optional(v.number()),
    end: v.optional(v.number()),
    category: v.optional(categoryV),
  },
  handler: async (ctx, { start, end, category }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    let rows = await ctx.db
      .query("expenses")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    if (start !== undefined) rows = rows.filter((r) => r.date >= start);
    if (end !== undefined) rows = rows.filter((r) => r.date < end);
    if (category) rows = rows.filter((r) => r.category === category);
    rows.sort((a, b) => b.date - a.date);
    return await Promise.all(
      rows.map(async (r) => ({
        ...r,
        memberName: r.memberId ? (await ctx.db.get(r.memberId))?.name ?? null : null,
        receiptUrl: r.receiptId ? await ctx.storage.getUrl(r.receiptId) : null,
      })),
    );
  },
});

/**
 * Profit-and-loss roll-up for a window. Collected revenue is paid `payments`
 * (session deposits/balances) plus paid ad-hoc `invoices` (no session link, so
 * session revenue isn't double-counted), minus expenses in the window. Also
 * returns the monthly recurring expense run-rate.
 */
export const plReport = query({
  args: { start: v.number(), end: v.number() },
  handler: async (ctx, { start, end }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");

    const payments = await ctx.db
      .query("payments")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const paymentRevenue = payments
      .filter((p) => p.status === "paid")
      .filter((p) => {
        const at = p.paidAt ?? p._creationTime;
        return at >= start && at < end;
      })
      .reduce((s, p) => s + p.amountCents, 0);

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const invoiceRevenue = invoices
      .filter((i) => i.status === "paid" && !i.sessionId && i.paidAt && i.paidAt >= start && i.paidAt < end)
      .reduce((s, i) => s + i.amountCents, 0);

    const revenueCents = paymentRevenue + invoiceRevenue;

    const expenses = await ctx.db
      .query("expenses")
      .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", start).lt("date", end))
      .collect();

    const summary = plSummary(
      revenueCents,
      expenses.map((e) => ({ category: e.category, amountCents: e.amountCents })),
    );

    const monthlyRecurringCents = expenses.reduce(
      (s, e) => s + monthlyRunRateCents(e.amountCents, e.recurring),
      0,
    );

    return {
      ...summary,
      revenueFromPaymentsCents: paymentRevenue,
      revenueFromInvoicesCents: invoiceRevenue,
      expenseCount: expenses.length,
      monthlyRecurringCents,
    };
  },
});
